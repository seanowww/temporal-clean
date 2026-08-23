import OpenAI from "openai";
import type { ArtifactEvent, ArtifactPayload } from "./types";
import { canAccessNode, evidenceVisibleToPullRequest, traverseGraph, type GraphNodeRecord } from "./graph";
import { listPullRequestFiles } from "./github-app";
import { CLAUDE_MEM_PROVIDER } from "./claude-mem/normalize";
import {
  getGraphNodeBySource,
  getPullRequest,
  listGraphEdges,
  listGraphNodes,
  saveArtifact,
  setPullRequestArtifactStatus,
  upsertPullRequest,
  type StoredPullRequest,
} from "./store";

export type ArtifactOptions = {
  useAi?: boolean;
  minimumScore?: number;
  limit?: number;
  viewerSubjects?: string[];
  selectedNodeIds?: string[];
  summaryOverride?: string;
  qaFocus?: string[];
  statusOverride?: "ready" | "limited";
  model?: string;
  filePaths?: string[];
};

/**
 * Raw agent chatter is graph context, not timeline evidence: transcript messages, tool
 * calls, and user prompts stay traversable but never render as artifact events. Compressed
 * records (`agent_observation`, `agent_summary`) are the exception — they are already the
 * distilled decision a reviewer needs.
 */
const NON_EVENT_TYPES = new Set(["message", "tool_call", "agent_prompt"]);

/**
 * A connector that scores its own evidence via `metadata.imp` is declaring how much the
 * record explains. Routine agent chatter — a lint pass, an import reorder — clears the
 * traversal threshold easily once it shares a branch and a changed file with the PR, so
 * score cannot separate it from a decision. Importance can. Low-signal records stay
 * traversable graph context but never compete with a decision for timeline space.
 */
const MINIMUM_EVENT_IMPORTANCE = 3;

const ticketPattern = /\b[A-Z][A-Z0-9]{1,9}-\d+\b/g;

/** Keep in step with `lib/agent/pr-agent.ts`; both default to the same model. */
const DEFAULT_MODEL = "gpt-5-mini";

/** Matches the traversal scoring window: nothing older than this belongs on a PR timeline. */
const MAX_TIMELINE_DAYS = 14;

function sourceForArtifact(source: string) {
  return source === "github" ? "git" : source;
}

function truncate(value: string, length = 1_200) {
  return value.length > length ? `${value.slice(0, length)}\n…` : value;
}

/**
 * A rolled-up transcript is one event but not one moment. Without saying so, an excerpt
 * whose last turns happened a day later reads as an effect preceding its cause.
 */
function sessionWindow(node: { occurredAt: string; metadata: Record<string, unknown> }) {
  const endedAt = typeof node.metadata.endedAt === "string" ? Date.parse(node.metadata.endedAt) : NaN;
  const startedAt = Date.parse(node.occurredAt);
  if (!Number.isFinite(endedAt) || !Number.isFinite(startedAt)) return null;
  const hours = (endedAt - startedAt) / (60 * 60 * 1_000);
  if (hours < 2) return null;
  return `This session ran over ${Math.round(hours)} hours, so later turns in the excerpt happen after events shown below it.`;
}

/**
 * The inclusion rationale shown to a reviewer was the raw traversal reason list
 * ("graph path depth 1, matching branch, same repository") — a scoring log, not a
 * reason. This states the same facts as claims a reviewer can check, and is careful
 * not to present an import-time stamp as a discovered signal.
 */
function explainInclusion(node: GraphNodeRecord, reasons: string[], pr: { body?: string; branch: string; title: string }) {
  const claims: string[] = [];
  const has = (fragment: string) => reasons.some((reason) => reason.includes(fragment));

  if (has("matching commit SHA")) claims.push("It is attached to the exact commit this pull request proposes.");
  else if (has("graph path depth 0") || has("graph path depth 1")) claims.push("It is linked directly to the pull request in the provenance graph.");
  else if (has("graph path depth")) claims.push("It reaches the pull request through the provenance graph.");

  const ticket = reasons.find((reason) => reason.startsWith("mentions "))?.slice("mentions ".length);
  if (ticket) claims.push(`It names ${ticket}, which the pull request also references.`);

  if (has("matching branch")) {
    claims.push(node.metadata.importedFrom
      ? `It was filed under branch ${node.branch} when this export was imported, rather than carrying that branch itself.`
      : `It was recorded against branch ${node.branch}.`);
  }

  // A claim the reader can verify in one glance at the PR — and the product's whole point.
  const subject = [node.title, node.content].join("\n").toLowerCase();
  const prText = `${pr.title}\n${pr.body || ""}`.toLowerCase();
  const distinctive = subject.split(/[^a-z0-9_]+/).filter((word) => word.length > 6);
  const echoed = distinctive.some((word) => prText.includes(word));
  if (!echoed && node.source !== "github") claims.push("Nothing in the pull request description refers to it.");

  return claims.join(" ") || `Recovered from ${node.source} inside the pull request's development window.`;
}

/**
 * Changed-file paths link agent memory to a PR far more precisely than branch alone, but
 * webhooks omit them. Resolve once, cache on the PR, and treat an unreachable GitHub as
 * "no file signal" rather than a failure.
 */
async function resolvePullRequestFiles(pr: StoredPullRequest) {
  const cached = pr.metadata?.filePaths;
  if (Array.isArray(cached)) return cached.filter((entry): entry is string => typeof entry === "string");
  const files = await listPullRequestFiles(pr.repository, pr.number);
  if (files.length) upsertPullRequest({ ...pr, metadata: { ...pr.metadata, filePaths: files } });
  return files;
}

function buildSummaryFallback(events: ArtifactEvent[]) {
  const linkedIssue = events.find((event) => event.src === "jira");
  if (linkedIssue) return linkedIssue.title;
  const consequential = events.filter((event) => Number(event.imp) >= 4 && event.src !== "git").slice(0, 3);
  if (!consequential.length) return `${events.length} evidence records recovered from the PR development window.`;
  return consequential.map((event) => event.title).join(" · ");
}

function compactEvidenceTitle(title: string) {
  return title.replace(/\s+/g, " ").trim().replace(/[.?!]+$/, "").slice(0, 120);
}

function deterministicChecks(node: GraphNodeRecord) {
  const existing = Array.isArray(node.metadata.tests)
    ? node.metadata.tests.filter((value): value is string => typeof value === "string" && Boolean(value.trim()))
    : [];
  if (existing.length) return existing;

  const title = compactEvidenceTitle(node.title);
  if (!title) return [];

  if (node.type === "commit" && node.commitSha) {
    return [`Review the diff for ${node.commitSha.slice(0, 7)} against its commit message: ${title}.`];
  }
  if (node.source === "slack" && node.type === "message") {
    return [`Check whether the implementation addresses the Slack-reported case: ${title}.`];
  }
  if (node.type === "issue") {
    return [`Verify the PR satisfies the linked issue state and acceptance text: ${title}.`];
  }
  if (node.type === "document") {
    return [`Compare the changed behavior with the referenced document: ${title}.`];
  }
  if ((node.source === "claude" || node.source === "codex") && node.type === "agent_session") {
    return [`Inspect the diff for the agent-session decision or constraint: ${title}.`];
  }
  return [];
}

async function synthesizeSummary(events: ArtifactEvent[]) {
  if (!process.env.OPENAI_API_KEY) return null;
  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const model = process.env.OPENAI_MODEL || DEFAULT_MODEL;
  const evidence = events.map((event) => ({ id: event.id, source: event.src, title: event.title, excerpt: event.excerpt, tests: event.tests }));
  const response = await client.responses.create({
    model,
    input: [
      { role: "developer", content: "Summarize PR provenance for QA in two concise sentences. Use only supplied evidence. Cite material evidence IDs in square brackets." },
      { role: "user", content: JSON.stringify(evidence) },
    ],
  });
  return response.output_text.trim() || null;
}

export async function assembleArtifact(pullRequestId: string, options: ArtifactOptions = {}) {
  const pr = getPullRequest(pullRequestId);
  if (!pr) throw new Error(`Unknown pull request ${pullRequestId}`);
  const prNode = getGraphNodeBySource("github", `${pr.repository}#${pr.number}`);
  if (!prNode) throw new Error(`Pull request ${pullRequestId} has no graph anchor`);

  setPullRequestArtifactStatus(pr.id, "building");
  const viewerSubjects = options.viewerSubjects || (process.env.TEMPORAL_VIEWER_SUBJECTS || "").split(",").map((value) => value.trim()).filter(Boolean);
  const accessible = listGraphNodes(pr.workspaceId).filter((node) => canAccessNode(node, viewerSubjects));
  const allNodes = evidenceVisibleToPullRequest(accessible, pr.metadata?.synthetic === true);
  const allEdges = listGraphEdges(pr.workspaceId);
  const ticketIds = [...new Set(`${pr.title}\n${pr.body}`.match(ticketPattern) || [])];
  const filePaths = options.filePaths ?? await resolvePullRequestFiles(pr);
  const candidates = traverseGraph({
    nodeId: prNode.id,
    repository: pr.repository,
    branch: pr.branch,
    author: pr.author,
    headSha: pr.headSha,
    openedAt: pr.openedAt,
    ticketIds,
    filePaths,
  }, allNodes, allEdges, { minimumScore: options.minimumScore, limit: options.limit ?? 30 });

  const requested = options.selectedNodeIds?.length ? new Set(options.selectedNodeIds) : null;
  const agentSources = new Set(["claude", "codex"]);
  // Any transcript-shaped record type (raw message, tool call, or raw prompt) from an agent
  // source is graph context, not a timeline event — only claude-mem's compressed
  // agent_observation/agent_summary types are already-distilled decisions.
  const isTranscriptDetail = (node: { source: string; type: string; metadata: Record<string, unknown> }) => {
    if (!agentSources.has(node.source)) return false;
    if (NON_EVENT_TYPES.has(node.type)) return true;
    /**
     * A claude-mem session node is an empty container — its observations and summary carry
     * every word of the content. Rendering it puts a contentless row on the timeline and
     * makes `qaFocusFor` emit a placeholder QA step pointed at nothing. A raw-transcript
     * session is the opposite: the transcript is its content and its only representation,
     * so it stays.
     */
    return node.type === "agent_session" && node.metadata.provider === CLAUDE_MEM_PROVIDER;
  };

  const isLowSignal = (node: { metadata: Record<string, unknown> }) => {
    const importance = Number(node.metadata.imp);
    return Number.isFinite(importance) && importance < MINIMUM_EVENT_IMPORTANCE;
  };

  /**
   * Evidence that predates the PR by more than the traversal window, or that claims to
   * happen after it, is a correlation mistake or a bad timestamp — either way it makes
   * the timeline read as fiction. Drop it rather than render impossible chronology.
   */
  const openedMs = Date.parse(pr.openedAt);
  const windowStart = openedMs - MAX_TIMELINE_DAYS * 24 * 60 * 60 * 1_000;
  const withinTimeline = (node: { occurredAt: string }) => {
    const occurred = Date.parse(node.occurredAt);
    return Number.isFinite(occurred) && occurred >= windowStart && occurred <= openedMs + 60 * 60 * 1_000;
  };

  const excluded = { transcriptDetail: 0, outsideWindow: 0, lowSignal: 0 };
  const selected = candidates.filter(({ node }) => {
    if (requested) return requested.has(node.id); // An explicit selection overrides every heuristic.
    if (isTranscriptDetail(node)) { excluded.transcriptDetail++; return false; }
    if (isLowSignal(node)) { excluded.lowSignal++; return false; }
    if (!withinTimeline(node)) { excluded.outsideWindow++; return false; }
    return true;
  });
  const opened = Date.parse(pr.openedAt);
  /**
   * Importance answers the product's actual question — how much does this record
   * explain that the diff does not? Ranking by traversal score alone inverted that:
   * scores tie once repository and branch match, so the agent session that killed the
   * whole approach ranked below a bug report. Evidence that already lives in the diff
   * is weighted down; evidence that exists nowhere else is weighted up.
   */
  const carriedByDiff = new Set(["github", "git"]);
  const undocumentedDecision = new Set(["claude", "codex"]);
  const ranked = [...selected].sort((a, b) => b.score - a.score).map(({ node }) => node.id);
  const importanceFor = (node: { id: string; source: string; type: string }) => {
    const position = ranked.length > 1 ? ranked.indexOf(node.id) / (ranked.length - 1) : 0;
    const rankBonus = position <= .34 ? 1 : 0;
    const base = undocumentedDecision.has(node.source) ? 4
      : carriedByDiff.has(node.source) ? 2
      : 3;
    return Math.min(5, base + rankBonus);
  };

  const events: ArtifactEvent[] = selected.map(({ node, score, reasons }, index) => {
    const metadata = node.metadata;
    const originalImportance = Number(metadata.imp);
    const importance = Number.isFinite(originalImportance) ? originalImportance : importanceFor(node);
    const daysBefore = Math.max(.1, (opened - Date.parse(node.occurredAt)) / (24 * 60 * 60 * 1_000));
    return {
      id: node.id,
      t: Number(daysBefore.toFixed(2)),
      lane: typeof metadata.lane === "number" ? metadata.lane : 0,
      src: sourceForArtifact(node.source),
      imp: importance,
      place: metadata.place === "left" || metadata.place === "right" ? metadata.place : index % 3 === 0 ? "left" : "right",
      short: typeof metadata.short === "string" ? metadata.short : node.title,
      title: node.title,
      stamp: typeof metadata.stamp === "string" ? metadata.stamp : `${node.source} · ${node.actorId || "system"}`,
      why: typeof metadata.why === "string" ? metadata.why : [explainInclusion(node, reasons, pr), sessionWindow(node)].filter(Boolean).join(" "),
      spanEndsAt: typeof metadata.endedAt === "string" ? metadata.endedAt : undefined,
      excerpt: typeof metadata.excerpt === "string" ? metadata.excerpt : truncate(node.content),
      tests: deterministicChecks(node),
      drift: typeof metadata.drift === "string" ? metadata.drift : undefined,
      pruned: Boolean(metadata.pruned),
      pulse: importance >= 5,
      evidenceId: node.sourceId,
      inclusionReasons: reasons,
    };
  });

  const prEventId = prNode.id;
  events.push({
    id: prEventId,
    t: .05,
    lane: 0,
    src: "git",
    imp: 5,
    place: "right",
    short: `PR #${pr.number} opened`,
    title: pr.title,
    stamp: `${pr.repository} · ${pr.author}`,
    why: "The PR is the traversal anchor. Every earlier record must explain or constrain the code under review.",
    excerpt: truncate(pr.body || `${pr.title}\n${pr.headSha || ""}`),
    tests: options.qaFocus || [],
    pulse: true,
    evidenceId: prNode.sourceId,
  });

  events.sort((a, b) => b.t - a.t);
  const eventIds = new Set(events.map((event) => event.id));
  const edges: [string, string, string][] = [];
  for (let index = 1; index < events.length; index++) edges.push([events[index - 1].id, events[index].id, "spine"]);
  for (const edge of allEdges) {
    if (!eventIds.has(edge.fromNodeId) || !eventIds.has(edge.toNodeId)) continue;
    if (edges.some(([from, to]) => from === edge.fromNodeId && to === edge.toNodeId)) continue;
    edges.push([edge.fromNodeId, edge.toNodeId, edge.type === "REJECTS" ? "pruned" : "context"]);
  }
  const hasPrunedBranch = edges.some(([, , channel]) => channel === "pruned") || events.some((event) => event.pruned === true);

  let summary = options.summaryOverride || buildSummaryFallback(events);
  let model: string | undefined = options.model;
  if (options.useAi && !options.summaryOverride) {
    const generated = await synthesizeSummary(events);
    if (generated) {
      summary = generated;
      model = process.env.OPENAI_MODEL || DEFAULT_MODEL;
    }
  }

  const counts = new Map<string, number>();
  events.forEach((event) => counts.set(event.src, (counts.get(event.src) || 0) + 1));

  /**
   * Coverage used to report `status: "complete"` for every source unconditionally.
   * Nothing computed it, so the artifact asserted full coverage of sources it had
   * barely touched. A source is only "complete" when we know what there was to fetch
   * and fetched it; otherwise say so, and name the gap.
   */
  const gaps: string[] = [];
  const declaredCommits = Number(pr.metadata?.commitCount);
  const ingestedCommits = allNodes.filter((node) => node.type === "commit" && node.repository === pr.repository && node.branch === pr.branch).length;
  const backfilled = Boolean(pr.metadata?.backfilledAt);
  if (Number.isFinite(declaredCommits) && declaredCommits > ingestedCommits) {
    gaps.push(`${declaredCommits - ingestedCommits} of ${declaredCommits} commits on this PR were not ingested${backfilled ? "" : " — GitHub API access is not configured"}.`);
  }
  if (!backfilled) gaps.push("Changed files were not read from GitHub; the diff itself is not part of this reconstruction.");

  const coverageStatus = (source: string) => {
    if (source !== "git") return "imported" as const;
    if (!backfilled) return "unverified" as const;
    return Number.isFinite(declaredCommits) && declaredCommits > ingestedCommits ? "partial" as const : "complete" as const;
  };
  const payload: ArtifactPayload = {
    id: "pending",
    pullRequestId: pr.id,
    version: 1,
    status: options.statusOverride || (events.length > 1 ? "ready" : "limited"),
    generatedAt: new Date().toISOString(),
    summary,
    events,
    edges,
    coverage: [...counts.entries()].map(([source, records]) => ({ source, records, status: coverageStatus(source) })),
    excluded,
    gaps,
    hasPrunedBranch,
    pullRequest: {
      number: pr.number,
      repository: pr.repository,
      title: pr.title,
      author: pr.author,
      filesChanged: typeof pr.metadata?.filesChanged === "number" ? pr.metadata.filesChanged : undefined,
      additions: typeof pr.metadata?.additions === "number" ? pr.metadata.additions : undefined,
      deletions: typeof pr.metadata?.deletions === "number" ? pr.metadata.deletions : undefined,
    },
  };
  return saveArtifact(payload, model);
}
