import type { GraphNodeInput } from "../store";
import { resolveGitContext, type GitContextEntry } from "./git-context";
import type { ClaudeMemObservation, ClaudeMemPrompt, ClaudeMemSnapshot, ClaudeMemSummary } from "./types";

export const CLAUDE_MEM_PROVIDER = "claude-mem";

/**
 * claude-mem installs into any of the coding agents it supports (Claude Code, Codex, Cursor,
 * Windsurf, Antigravity, ...) and tags every session with which one wrote it
 * (`sdk_sessions.platform_source`, already normalized by claude-mem itself). Codex has its own
 * source identity throughout Temporal — dedicated logo, accent color, and traversal styling —
 * so a Codex session earns the `codex` source instead of being folded into Claude Code's. Every
 * other platform (Cursor, Windsurf, ...) doesn't have that dedicated styling yet and falls back
 * to `claude`; the true platform is preserved on every node as `metadata.platform` regardless,
 * so a record is never silently misattributed even when the display can't distinguish it yet.
 */
function sourceForPlatform(platformSource?: string) {
  return platformSource === "codex" ? "codex" : "claude";
}

const PLATFORM_LABELS: Record<string, string> = {
  claude: "Claude Code",
  codex: "Codex",
  cursor: "Cursor",
};

function platformLabel(platformSource?: string) {
  if (!platformSource) return PLATFORM_LABELS.claude;
  return PLATFORM_LABELS[platformSource] || platformSource.replace(/(^|-)([a-z])/g, (_, sep, letter) => `${sep ? " " : ""}${letter.toUpperCase()}`);
}

export type NormalizedRecord = {
  node: GraphNodeInput;
  sessionSourceId?: string;
  parentSourceId?: string;
};

/**
 * A decision is the record Temporal exists to surface, so it anchors the timeline.
 * Routine `change` observations stay low enough to fall below the traversal threshold
 * unless another signal (matching branch, shared file) lifts them.
 */
const IMPORTANCE: Record<string, number> = {
  decision: 5,
  discovery: 4,
  bugfix: 4,
  feature: 4,
  refactor: 3,
  change: 2,
};

export const observationImportance = (type: string) => IMPORTANCE[type] ?? 2;

const PRIVATE_PATTERN = /<private>[\s\S]*?<\/private>/gi;

/** claude-mem lets users fence content with `<private>`; that content must never reach an artifact. */
export function stripPrivate(value: string | undefined) {
  return (value || "").replace(PRIVATE_PATTERN, "").trim();
}

const clamp = (value: string, length: number) => (value.length > length ? `${value.slice(0, length)}…` : value);

function excerptFor(observation: ClaudeMemObservation) {
  const narrative = stripPrivate(observation.narrative || observation.text);
  const facts = observation.facts.map(stripPrivate).filter(Boolean);
  return [narrative, facts.length ? facts.map((fact) => `• ${fact}`).join("\n") : ""].filter(Boolean).join("\n\n");
}

function sessionRecord(
  sessionId: string,
  project: string,
  occurredAt: string,
  context: ReturnType<typeof resolveGitContext>,
  actor?: string,
  platformSource?: string,
): NormalizedRecord {
  return {
    node: {
      type: "agent_session",
      source: sourceForPlatform(platformSource),
      sourceId: `claude-mem:session:${sessionId}`,
      title: `${platformLabel(platformSource)} session · ${project}`,
      content: "",
      occurredAt,
      actorId: actor,
      repository: context.repository,
      branch: context.branch,
      commitSha: context.commitSha,
      metadata: { provider: CLAUDE_MEM_PROVIDER, platform: platformSource || "claude", project, sessionId, linkage: context.confidence, kind: "session" },
    },
  };
}

export type NormalizeOptions = {
  ledger?: GitContextEntry[];
  actor?: string;
  importedFrom?: string;
  importedAt?: string;
};

export function normalizeSnapshot(snapshot: ClaudeMemSnapshot, options: NormalizeOptions = {}): NormalizedRecord[] {
  const ledger = options.ledger ?? [];
  const importedFrom = options.importedFrom || "claude-mem";
  const importedAt = options.importedAt || new Date().toISOString();
  const records: NormalizedRecord[] = [];
  const sessions = new Map<string, { project: string; occurredAt: string; epoch: number; platformSource?: string }>();

  const noteSession = (sessionId: string, project: string, occurredAt: string, epoch: number, platformSource?: string) => {
    if (!sessionId) return;
    const existing = sessions.get(sessionId);
    if (!existing || epoch < existing.epoch) sessions.set(sessionId, { project, occurredAt, epoch, platformSource: platformSource || existing?.platformSource });
    else if (!existing.platformSource && platformSource) existing.platformSource = platformSource;
  };

  const ordered = [...snapshot.observations].sort((a, b) => a.createdAtEpoch - b.createdAtEpoch);
  const previousBySession = new Map<string, string>();

  for (const observation of ordered) {
    const context = resolveGitContext(observation.project, observation.createdAtEpoch, ledger, observation.sessionId);
    const sourceId = `claude-mem:obs:${observation.id}`;
    const excerpt = excerptFor(observation);
    const title = stripPrivate(observation.title) || "Agent observation";
    noteSession(observation.sessionId, observation.project, observation.createdAt, observation.createdAtEpoch, observation.platformSource);
    records.push({
      node: {
        type: "agent_observation",
        source: sourceForPlatform(observation.platformSource),
        sourceId,
        title,
        content: excerpt,
        occurredAt: observation.createdAt,
        actorId: options.actor,
        repository: context.repository,
        branch: context.branch,
        commitSha: context.commitSha,
        metadata: {
          provider: CLAUDE_MEM_PROVIDER,
          platform: observation.platformSource || "claude",
          kind: "observation",
          observationType: observation.type,
          project: observation.project,
          sessionId: observation.sessionId,
          promptNumber: observation.promptNumber,
          concepts: observation.concepts,
          facts: observation.facts.map(stripPrivate).filter(Boolean),
          filesRead: observation.filesRead,
          filesModified: observation.filesModified,
          linkage: context.confidence,
          claudeMemId: observation.id,
          // Presentation hints consumed directly by lib/artifact.ts.
          imp: observationImportance(String(observation.type)),
          short: clamp(title, 72),
          stamp: `claude-mem · ${platformLabel(observation.platformSource)} · ${observation.type}`,
          why: stripPrivate(observation.subtitle) || stripPrivate(observation.narrative) || `Recorded as a ${observation.type} while working in ${observation.project}.`,
          excerpt: clamp(excerpt || title, 1_200),
          importedFrom,
          importedAt,
        },
      },
      sessionSourceId: observation.sessionId ? `claude-mem:session:${observation.sessionId}` : undefined,
      parentSourceId: previousBySession.get(observation.sessionId),
    });
    if (observation.sessionId) previousBySession.set(observation.sessionId, sourceId);
  }

  for (const summary of snapshot.summaries) {
    const context = resolveGitContext(summary.project, summary.createdAtEpoch, ledger, summary.sessionId);
    const body = [
      summary.request && `Request: ${stripPrivate(summary.request)}`,
      summary.investigated && `Investigated: ${stripPrivate(summary.investigated)}`,
      summary.learned && `Learned: ${stripPrivate(summary.learned)}`,
      summary.completed && `Completed: ${stripPrivate(summary.completed)}`,
      summary.notes && `Notes: ${stripPrivate(summary.notes)}`,
    ].filter(Boolean).join("\n\n");
    const title = clamp(stripPrivate(summary.request) || stripPrivate(summary.completed) || "Session summary", 120);
    noteSession(summary.sessionId, summary.project, summary.createdAt, summary.createdAtEpoch, summary.platformSource);
    records.push({
      node: {
        type: "agent_summary",
        source: sourceForPlatform(summary.platformSource),
        sourceId: `claude-mem:summary:${summary.id}`,
        title,
        content: body,
        occurredAt: summary.createdAt,
        actorId: options.actor,
        repository: context.repository,
        branch: context.branch,
        commitSha: context.commitSha,
        metadata: {
          provider: CLAUDE_MEM_PROVIDER,
          platform: summary.platformSource || "claude",
          kind: "summary",
          project: summary.project,
          sessionId: summary.sessionId,
          linkage: context.confidence,
          claudeMemId: summary.id,
          imp: 4,
          short: clamp(title, 72),
          stamp: `claude-mem · ${platformLabel(summary.platformSource)} · session summary`,
          why: stripPrivate(summary.learned) || "Summarizes what the agent session established before the PR opened.",
          excerpt: clamp(body || title, 1_200),
          // next_steps are unfinished intent, which is exactly what QA should probe.
          tests: summary.nextSteps.map(stripPrivate).filter(Boolean),
          importedFrom,
          importedAt,
        },
      },
      sessionSourceId: summary.sessionId ? `claude-mem:session:${summary.sessionId}` : undefined,
    });
  }

  for (const prompt of snapshot.prompts) {
    const context = resolveGitContext(prompt.project, prompt.createdAtEpoch, ledger, prompt.sessionId);
    const text = stripPrivate(prompt.text);
    if (!text) continue;
    noteSession(prompt.sessionId, prompt.project, prompt.createdAt, prompt.createdAtEpoch, prompt.platformSource);
    records.push({
      node: {
        type: "agent_prompt",
        source: sourceForPlatform(prompt.platformSource),
        sourceId: `claude-mem:prompt:${prompt.id}`,
        title: clamp(text.split("\n")[0], 120),
        content: text,
        occurredAt: prompt.createdAt,
        actorId: options.actor,
        repository: context.repository,
        branch: context.branch,
        commitSha: context.commitSha,
        metadata: {
          provider: CLAUDE_MEM_PROVIDER,
          platform: prompt.platformSource || "claude",
          kind: "prompt",
          project: prompt.project,
          sessionId: prompt.sessionId,
          promptNumber: prompt.promptNumber,
          linkage: context.confidence,
          claudeMemId: prompt.id,
          importedFrom,
          importedAt,
        },
      },
      sessionSourceId: prompt.sessionId ? `claude-mem:session:${prompt.sessionId}` : undefined,
    });
  }

  for (const [sessionId, session] of sessions) {
    const context = resolveGitContext(session.project, session.epoch, ledger, sessionId);
    records.push(sessionRecord(sessionId, session.project, session.occurredAt, context, options.actor, session.platformSource));
  }

  return records;
}
