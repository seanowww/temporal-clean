import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import {
  toObservation,
  toPrompt,
  toSummary,
  type ClaudeMemObservation,
  type ClaudeMemPrompt,
  type ClaudeMemSnapshot,
  type ClaudeMemSummary,
} from "./types";

export type Transport = "worker" | "sqlite" | "none";

export type FetchOptions = {
  project?: string;
  since?: number;
  limit?: number;
};

const PAGE_SIZE = 200;
const DEFAULT_LIMIT = 500;

export function claudeMemHome() {
  return process.env.CLAUDE_MEM_HOME || path.join(homedir(), ".claude-mem");
}

export function claudeMemDbPath() {
  return process.env.CLAUDE_MEM_DB_PATH || path.join(claudeMemHome(), "claude-mem.db");
}

/**
 * The worker binds to a per-user port (`37700 + uid % 100`) and records the live value in
 * settings.json, so prefer the recorded port and fall back to the formula.
 */
export function claudeMemWorkerUrl() {
  if (process.env.CLAUDE_MEM_WORKER_URL) return process.env.CLAUDE_MEM_WORKER_URL.replace(/\/$/, "");
  let port = Number(process.env.CLAUDE_MEM_WORKER_PORT);
  if (!Number.isInteger(port) || port <= 0) {
    const settingsPath = path.join(claudeMemHome(), "settings.json");
    if (existsSync(settingsPath)) {
      try {
        const settings = JSON.parse(readFileSync(settingsPath, "utf8")) as Record<string, unknown>;
        const recorded = Number(settings.workerPort ?? settings.port);
        if (Number.isInteger(recorded) && recorded > 0) port = recorded;
      } catch {
        // Unreadable settings fall through to the derived port.
      }
    }
  }
  if (!Number.isInteger(port) || port <= 0) port = 37_700 + ((process.getuid?.() ?? 0) % 100);
  return `http://127.0.0.1:${port}`;
}

async function workerJson(pathname: string, timeoutMs = 4_000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${claudeMemWorkerUrl()}${pathname}`, { signal: controller.signal });
    if (!response.ok) throw new Error(`claude-mem worker returned ${response.status}`);
    return await response.json() as Record<string, unknown>;
  } finally {
    clearTimeout(timer);
  }
}

export async function workerAvailable() {
  try {
    const health = await workerJson("/health", 1_500);
    return health.status === "ok" || Boolean(health.uptime);
  } catch {
    return false;
  }
}

export function sqliteAvailable() {
  return existsSync(claudeMemDbPath());
}

export async function detectTransport(): Promise<Transport> {
  if (process.env.CLAUDE_MEM_TRANSPORT === "sqlite") return sqliteAvailable() ? "sqlite" : "none";
  if (await workerAvailable()) return "worker";
  return sqliteAvailable() ? "sqlite" : "none";
}

type Collection = "observations" | "summaries" | "prompts";

/**
 * claude-mem 13.x wraps list responses in `items`; older builds and the published docs use
 * the collection name. Reading only one of them silently yields an empty sync.
 */
export function unwrapPage(body: Record<string, unknown>, collection: Collection) {
  if (Array.isArray(body.items)) return body.items as Record<string, unknown>[];
  if (Array.isArray(body[collection])) return body[collection] as Record<string, unknown>[];
  return null;
}

async function fetchFromWorker(collection: Collection, options: FetchOptions) {
  const limit = options.limit ?? DEFAULT_LIMIT;
  const rows: Record<string, unknown>[] = [];
  for (let offset = 0; rows.length < limit; offset += PAGE_SIZE) {
    const query = new URLSearchParams({ limit: String(Math.min(PAGE_SIZE, limit - rows.length)), offset: String(offset) });
    if (options.project) query.set("project", options.project);
    const body = await workerJson(`/api/${collection}?${query}`);
    const page = unwrapPage(body, collection);
    if (!page || !page.length) break;
    rows.push(...page);
    if (!body.hasMore) break;
  }
  return rows;
}

/**
 * Direct reads are the offline fallback. Column names have already moved once
 * (`sdk_session_id` to `memory_session_id`), so select `*` and let the row mappers
 * reconcile spellings instead of naming columns here.
 */
function fetchFromSqlite(collection: Collection, options: FetchOptions) {
  const table = collection === "summaries" ? "session_summaries" : collection === "prompts" ? "user_prompts" : "observations";
  const db = new DatabaseSync(claudeMemDbPath(), { readOnly: true, timeout: 5_000 });
  try {
    const columns = new Set((db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).map((column) => column.name));
    if (!columns.size) return [];
    /**
     * `user_prompts` carries neither a project nor the `memory_session_id` that observations
     * and summaries key on — only `content_session_id`. Without this join prompts land in a
     * second, duplicate session node and never resolve a repository. Every collection also
     * joins sdk_sessions for `platform_source`, which is how Temporal tells a Codex decision
     * from a Claude Code one; the worker API already does the equivalent join server-side.
     */
    const sessions = new Set((db.prepare(`PRAGMA table_info(sdk_sessions)`).all() as { name: string }[]).map((column) => column.name));
    const joinKey = table === "user_prompts" ? "content_session_id" : "memory_session_id";
    const canJoin = sessions.has(joinKey) && columns.has(joinKey);
    const hydrate = canJoin && table === "user_prompts" && !columns.has("project")
      && sessions.has("project") && sessions.has("memory_session_id");
    const from = canJoin
      ? `${table} t LEFT JOIN sdk_sessions s ON s.${joinKey} = t.${joinKey}`
      : `${table} t`;
    const selectParts = [hydrate
      ? "t.*, s.project AS project, COALESCE(s.memory_session_id, t.content_session_id) AS memory_session_id"
      : "t.*"];
    if (canJoin && sessions.has("platform_source")) selectParts.push("s.platform_source AS platform_source");
    const select = selectParts.join(", ");
    const filters: string[] = [];
    const params: (string | number)[] = [];
    if (options.project) {
      if (hydrate) { filters.push("s.project = ?"); params.push(options.project); }
      else if (columns.has("project")) { filters.push("t.project = ?"); params.push(options.project); }
    }
    if (options.since && columns.has("created_at_epoch")) { filters.push("t.created_at_epoch >= ?"); params.push(options.since); }
    const where = filters.length ? `WHERE ${filters.join(" AND ")}` : "";
    const order = columns.has("created_at_epoch") ? "t.created_at_epoch DESC" : "t.id DESC";
    params.push(options.limit ?? DEFAULT_LIMIT);
    return db.prepare(`SELECT ${select} FROM ${from} ${where} ORDER BY ${order} LIMIT ?`).all(...params) as Record<string, unknown>[];
  } finally {
    db.close();
  }
}

async function fetchRows(collection: Collection, transport: Transport, options: FetchOptions) {
  if (transport === "none") return [];
  const rows = transport === "worker" ? await fetchFromWorker(collection, options) : fetchFromSqlite(collection, options);
  if (!options.since) return rows;
  return rows.filter((row) => {
    const raw = Number(row.created_at_epoch);
    const at = Number.isFinite(raw) && raw > 0 ? (raw < 1e12 ? raw * 1_000 : raw) : Date.parse(String(row.created_at ?? ""));
    return !Number.isFinite(at) || at >= options.since!;
  });
}

export async function listProjects(transport?: Transport) {
  const resolved = transport ?? await detectTransport();
  if (resolved === "worker") {
    const body = await workerJson("/api/projects");
    return Array.isArray(body.projects) ? body.projects.map(String) : [];
  }
  if (resolved === "sqlite") {
    const db = new DatabaseSync(claudeMemDbPath(), { readOnly: true, timeout: 5_000 });
    try {
      return (db.prepare(`SELECT DISTINCT project FROM observations WHERE project IS NOT NULL`).all() as { project: string }[])
        .map((row) => row.project).filter(Boolean);
    } finally {
      db.close();
    }
  }
  return [];
}

export async function readSnapshot(options: FetchOptions = {}): Promise<ClaudeMemSnapshot & { transport: Transport }> {
  const transport = await detectTransport();
  if (transport === "none") return { transport, observations: [], summaries: [], prompts: [] };
  const [observations, summaries, prompts] = await Promise.all([
    fetchRows("observations", transport, options),
    fetchRows("summaries", transport, options),
    fetchRows("prompts", transport, options),
  ]);
  return {
    transport,
    observations: observations.map(toObservation).filter((entry) => Number.isFinite(entry.id)) as ClaudeMemObservation[],
    summaries: summaries.map(toSummary).filter((entry) => Number.isFinite(entry.id)) as ClaudeMemSummary[],
    prompts: prompts.map(toPrompt).filter((entry) => Number.isFinite(entry.id) && entry.text.trim()) as ClaudeMemPrompt[],
  };
}

/** Shape used by the file/paste importer so an offline export matches a live read. */
export function snapshotFromExport(data: unknown): ClaudeMemSnapshot {
  const root = (data && typeof data === "object" ? data : {}) as Record<string, unknown>;
  const pick = (...keys: string[]) => {
    for (const key of keys) if (Array.isArray(root[key])) return root[key] as Record<string, unknown>[];
    return [];
  };
  return {
    observations: pick("observations").map(toObservation).filter((entry) => Number.isFinite(entry.id)),
    summaries: pick("summaries", "session_summaries").map(toSummary).filter((entry) => Number.isFinite(entry.id)),
    prompts: pick("prompts", "user_prompts").map(toPrompt).filter((entry) => Number.isFinite(entry.id) && entry.text.trim()),
  };
}
