import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { projectMatches } from "./types";

/**
 * claude-mem scopes memory by `project` (a directory-derived name) and records no
 * repository, branch, or commit. Temporal links evidence by repository, branch, and SHA,
 * so a lightweight ledger written by `bin/temporal-hook.mjs` supplies the missing axis:
 * each entry stamps the git state of a working directory at a moment in time, and an
 * observation inherits the state that was current when it was captured.
 */
export type GitContextEntry = {
  sessionId?: string;
  project?: string;
  cwd?: string;
  repository: string;
  branch: string;
  headSha?: string;
  at: number;
};

export type GitContext = {
  repository?: string;
  branch?: string;
  commitSha?: string;
  confidence: "exact" | "interval" | "mapped" | "none";
};

const UNRESOLVED: GitContext = { confidence: "none" };

export function ledgerPath() {
  return process.env.TEMPORAL_GIT_CONTEXT_PATH || path.join(homedir(), ".claude", "temporal", "git-context.jsonl");
}

export function loadLedger(source?: string): GitContextEntry[] {
  const raw = source ?? (existsSync(ledgerPath()) ? readFileSync(ledgerPath(), "utf8") : "");
  if (!raw.trim()) return [];
  const entries: GitContextEntry[] = [];
  for (const line of raw.split(/\r?\n/)) {
    if (!line.trim()) continue;
    try {
      const parsed = JSON.parse(line) as Record<string, unknown>;
      const repository = String(parsed.repository || "");
      const branch = String(parsed.branch || "");
      const at = Number(parsed.at);
      if (!repository || !branch || !Number.isFinite(at)) continue;
      entries.push({
        repository,
        branch,
        at: at < 1e12 ? at * 1_000 : at,
        headSha: parsed.headSha ? String(parsed.headSha) : undefined,
        sessionId: parsed.sessionId ? String(parsed.sessionId) : undefined,
        project: parsed.project ? String(parsed.project) : undefined,
        cwd: parsed.cwd ? String(parsed.cwd) : undefined,
      });
    } catch {
      // A truncated trailing write must not discard the whole ledger.
    }
  }
  return entries.sort((a, b) => a.at - b.at);
}

/** `TEMPORAL_CLAUDE_MEM_PROJECTS="temporal=acme/platform-api,docs=acme/docs"` */
export function projectRepositoryMap(): Map<string, string> {
  const map = new Map<string, string>();
  for (const pair of (process.env.TEMPORAL_CLAUDE_MEM_PROJECTS || "").split(",")) {
    const [project, repository] = pair.split("=").map((value) => value.trim());
    if (project && repository) map.set(project.toLowerCase(), repository);
  }
  return map;
}

function entryMatches(entry: GitContextEntry, project: string, sessionId?: string) {
  if (sessionId && entry.sessionId && entry.sessionId === sessionId) return true;
  if (entry.project && projectMatches(entry.project, project)) return true;
  return Boolean(entry.cwd && projectMatches(path.basename(entry.cwd), project));
}

/**
 * Resolves the git state in effect when an observation was captured. A session-id hit is
 * exact; otherwise the newest entry at or before the observation wins, because the branch
 * a developer was on is the branch they stayed on until the ledger says otherwise.
 */
export function resolveGitContext(
  project: string,
  atEpoch: number,
  ledger: GitContextEntry[],
  sessionId?: string,
): GitContext {
  const candidates = ledger.filter((entry) => entryMatches(entry, project, sessionId));
  if (candidates.length) {
    const exact = sessionId ? candidates.filter((entry) => entry.sessionId === sessionId) : [];
    const pool = exact.length ? exact : candidates;
    const preceding = pool.filter((entry) => entry.at <= atEpoch);
    const chosen = preceding.length ? preceding[preceding.length - 1] : pool[0];
    return {
      repository: chosen.repository,
      branch: chosen.branch,
      commitSha: chosen.headSha,
      confidence: exact.length ? "exact" : "interval",
    };
  }
  const mapped = projectRepositoryMap();
  for (const [key, repository] of mapped) {
    if (projectMatches(project, key)) return { repository, confidence: "mapped" };
  }
  return UNRESOLVED;
}
