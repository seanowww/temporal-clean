export type ObservationType = "decision" | "bugfix" | "feature" | "refactor" | "discovery" | "change";

export type ClaudeMemObservation = {
  id: number;
  sessionId: string;
  project: string;
  type: ObservationType | string;
  title: string;
  subtitle?: string;
  narrative?: string;
  text?: string;
  facts: string[];
  concepts: string[];
  filesRead: string[];
  filesModified: string[];
  promptNumber?: number;
  platformSource?: string;
  createdAt: string;
  createdAtEpoch: number;
};

export type ClaudeMemSummary = {
  id: number;
  sessionId: string;
  project: string;
  request?: string;
  investigated?: string;
  learned?: string;
  completed?: string;
  nextSteps: string[];
  notes?: string;
  promptNumber?: number;
  platformSource?: string;
  createdAt: string;
  createdAtEpoch: number;
};

export type ClaudeMemPrompt = {
  id: number;
  sessionId: string;
  project: string;
  promptNumber?: number;
  text: string;
  platformSource?: string;
  createdAt: string;
  createdAtEpoch: number;
};

export type ClaudeMemSnapshot = {
  observations: ClaudeMemObservation[];
  summaries: ClaudeMemSummary[];
  prompts: ClaudeMemPrompt[];
};

type Row = Record<string, unknown>;

const str = (value: unknown) => (typeof value === "string" ? value : value == null ? "" : String(value));

/**
 * claude-mem renamed its session key from `sdk_session_id` to `memory_session_id`, and its
 * prompt rows use `content_session_id`. Read every known spelling so a claude-mem upgrade
 * degrades to a missing link rather than a crash.
 */
const sessionId = (row: Row) =>
  str(row.memory_session_id ?? row.sdk_session_id ?? row.content_session_id ?? row.session_id ?? row.sessionId);

const epoch = (row: Row, createdAt: string) => {
  const raw = Number(row.created_at_epoch ?? row.createdAtEpoch);
  if (Number.isFinite(raw) && raw > 0) return raw < 1e12 ? raw * 1_000 : raw;
  const parsed = Date.parse(createdAt);
  return Number.isFinite(parsed) ? parsed : Date.now();
};

const createdAt = (row: Row) => {
  const value = str(row.created_at ?? row.createdAt);
  const parsed = Date.parse(value);
  if (Number.isFinite(parsed)) return new Date(parsed).toISOString();
  const raw = Number(row.created_at_epoch ?? row.createdAtEpoch);
  return new Date(Number.isFinite(raw) && raw > 0 ? (raw < 1e12 ? raw * 1_000 : raw) : Date.now()).toISOString();
};

/** `files_read`, `files_modified`, `facts`, and `concepts` are JSON arrays, but older rows are plain text. */
export function toList(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(str).map((entry) => entry.trim()).filter(Boolean);
  const raw = str(value).trim();
  if (!raw) return [];
  if (raw.startsWith("[")) {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed.map(str).map((entry) => entry.trim()).filter(Boolean);
    } catch {
      // Fall through to delimiter splitting.
    }
  }
  return raw.split(/\r?\n|,/).map((entry) => entry.trim()).filter(Boolean);
}

const optional = (value: unknown) => {
  const text = str(value).trim();
  return text || undefined;
};

/**
 * claude-mem tags every session with the agent that produced it (`sdk_sessions.platform_source`)
 * and normalizes that tag itself — sanitize the same way here so a raw value read straight off
 * an older row (or a hand-built export) lines up with what the worker API already returns.
 */
export function normalizePlatformSource(value: unknown): string | undefined {
  const raw = str(value).trim().toLowerCase().replace(/\s+/g, "-");
  if (!raw) return undefined;
  if (raw === "transcript" || raw.includes("codex")) return "codex";
  if (raw.includes("cursor")) return "cursor";
  if (raw.includes("claude")) return "claude";
  return raw;
}

export function toObservation(row: Row): ClaudeMemObservation {
  const at = createdAt(row);
  const title = optional(row.title) || optional(row.subtitle) || optional(row.text) || "Agent observation";
  return {
    id: Number(row.id),
    sessionId: sessionId(row),
    project: str(row.project),
    type: optional(row.type) || "change",
    title: title.split("\n")[0].slice(0, 120),
    subtitle: optional(row.subtitle),
    narrative: optional(row.narrative),
    text: optional(row.text),
    facts: toList(row.facts),
    concepts: toList(row.concepts ?? row.concept),
    filesRead: toList(row.files_read ?? row.filesRead),
    filesModified: toList(row.files_modified ?? row.filesModified),
    promptNumber: Number.isFinite(Number(row.prompt_number)) ? Number(row.prompt_number) : undefined,
    platformSource: normalizePlatformSource(row.platform_source ?? row.platformSource),
    createdAt: at,
    createdAtEpoch: epoch(row, at),
  };
}

export function toSummary(row: Row): ClaudeMemSummary {
  const at = createdAt(row);
  return {
    id: Number(row.id),
    sessionId: sessionId(row),
    project: str(row.project),
    request: optional(row.request),
    investigated: optional(row.investigated),
    learned: optional(row.learned),
    completed: optional(row.completed),
    nextSteps: toList(row.next_steps ?? row.nextSteps),
    notes: optional(row.notes),
    promptNumber: Number.isFinite(Number(row.prompt_number)) ? Number(row.prompt_number) : undefined,
    platformSource: normalizePlatformSource(row.platform_source ?? row.platformSource),
    createdAt: at,
    createdAtEpoch: epoch(row, at),
  };
}

export function toPrompt(row: Row): ClaudeMemPrompt {
  const at = createdAt(row);
  return {
    id: Number(row.id),
    sessionId: sessionId(row),
    project: str(row.project),
    promptNumber: Number.isFinite(Number(row.prompt_number)) ? Number(row.prompt_number) : undefined,
    text: str(row.prompt_text ?? row.prompt ?? row.text),
    platformSource: normalizePlatformSource(row.platform_source ?? row.platformSource),
    createdAt: at,
    createdAtEpoch: epoch(row, at),
  };
}

/** claude-mem projects are directory-derived and often carry a worktree slug (`temporal/night-parsnip`). */
export function projectMatches(project: string, target: string) {
  const normalize = (value: string) => value.trim().toLowerCase().replace(/\\/g, "/");
  const [a, b] = [normalize(project), normalize(target)];
  if (!a || !b) return false;
  if (a === b) return true;
  const segments = (value: string) => value.split("/").filter(Boolean);
  const [left, right] = [segments(a), segments(b)];
  return left[0] === right[0] || left.at(-1) === right.at(-1);
}
