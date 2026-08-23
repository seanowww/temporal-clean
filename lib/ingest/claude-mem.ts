import { readSnapshot, snapshotFromExport, type Transport } from "../claude-mem/client";
import { loadLedger, type GitContextEntry } from "../claude-mem/git-context";
import { CLAUDE_MEM_PROVIDER, normalizeSnapshot, type NormalizedRecord } from "../claude-mem/normalize";
import type { ClaudeMemSnapshot } from "../claude-mem/types";
import { sharesFilePath } from "../graph";
import { getGraphNodeBySource, listPullRequests, upsertConnection, upsertGraphEdge, upsertGraphNode } from "../store";

export type ClaudeMemIngestOptions = {
  project?: string;
  since?: number;
  limit?: number;
  actor?: string;
  ledger?: GitContextEntry[];
  importedFrom?: string;
};

export type ClaudeMemIngestResult = {
  transport: Transport | "export";
  observations: number;
  summaries: number;
  prompts: number;
  sessions: number;
  nodes: number;
  edges: number;
  linkedPullRequests: string[];
  unresolved: number;
};

const asList = (value: unknown) => (Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : []);

function persist(records: NormalizedRecord[]) {
  const ids = new Map<string, string>();
  // Sessions first so CONTAINS edges always find their parent.
  const ordered = [...records].sort((a, b) => Number(b.node.type === "agent_session") - Number(a.node.type === "agent_session"));
  for (const record of ordered) ids.set(record.node.sourceId, upsertGraphNode(record.node));

  let edges = 0;
  for (const record of records) {
    const id = ids.get(record.node.sourceId);
    if (!id) continue;
    const sessionId = record.sessionSourceId && ids.get(record.sessionSourceId);
    if (sessionId && sessionId !== id) { upsertGraphEdge({ fromNodeId: sessionId, toNodeId: id, type: "CONTAINS", confidence: 1 }); edges++; }
    const parentId = record.parentSourceId && ids.get(record.parentSourceId);
    if (parentId && parentId !== id) { upsertGraphEdge({ fromNodeId: parentId, toNodeId: id, type: "PRECEDES", confidence: .95 }); edges++; }
  }
  return { ids, edges };
}

function linkToPullRequests(records: NormalizedRecord[], ids: Map<string, string>) {
  const linked = new Set<string>();
  let edges = 0;
  for (const pr of listPullRequests()) {
    const prNode = getGraphNodeBySource("github", `${pr.repository}#${pr.number}`);
    if (!prNode) continue;
    const prFiles = asList(pr.metadata?.filePaths);
    for (const record of records) {
      const id = ids.get(record.node.sourceId);
      if (!id) continue;
      const sameRepository = record.node.repository === pr.repository;
      const sameBranch = sameRepository && record.node.branch === pr.branch;
      const files = [...asList(record.node.metadata?.filesModified), ...asList(record.node.metadata?.filesRead)];
      const fileOverlap = sharesFilePath(files, prFiles);
      if (!sameBranch && !fileOverlap) continue;
      upsertGraphEdge({
        fromNodeId: prNode.id,
        toNodeId: id,
        type: sameBranch ? "DERIVED_FROM" : "CONTEXT_FOR",
        confidence: sameBranch ? 1 : .8,
        metadata: { via: sameBranch ? "branch" : "changed-file", provider: CLAUDE_MEM_PROVIDER },
      });
      linked.add(pr.id);
      edges++;
    }
  }
  return { linkedPullRequests: [...linked], edges };
}

function summarize(
  snapshot: ClaudeMemSnapshot,
  records: NormalizedRecord[],
  transport: ClaudeMemIngestResult["transport"],
  persisted: { ids: Map<string, string>; edges: number },
  linkage: { linkedPullRequests: string[]; edges: number },
): ClaudeMemIngestResult {
  const sessions = records.filter((record) => record.node.type === "agent_session").length;
  const unresolved = records.filter((record) => record.node.metadata?.linkage === "none").length;
  upsertConnection({
    id: CLAUDE_MEM_PROVIDER,
    name: "claude-mem",
    description: "Compressed agent decisions, discoveries, and session summaries",
    status: transport === "none" ? "needs_attention" : "connected",
    scope: transport === "none"
      ? "claude-mem not detected"
      : `${snapshot.observations.length} observations · ${transport === "export" ? "imported export" : `${transport} transport`}`,
    lastSync: new Date().toISOString(),
    metadata: { transport, unresolved, sessions },
  });
  return {
    transport,
    observations: snapshot.observations.length,
    summaries: snapshot.summaries.length,
    prompts: snapshot.prompts.length,
    sessions,
    nodes: persisted.ids.size,
    edges: persisted.edges + linkage.edges,
    linkedPullRequests: linkage.linkedPullRequests,
    unresolved,
  };
}

function ingestSnapshot(
  snapshot: ClaudeMemSnapshot,
  transport: ClaudeMemIngestResult["transport"],
  options: ClaudeMemIngestOptions,
) {
  const records = normalizeSnapshot(snapshot, {
    ledger: options.ledger ?? loadLedger(),
    actor: options.actor,
    importedFrom: options.importedFrom || (transport === "export" ? "claude-mem export" : `claude-mem (${transport})`),
  });
  const persisted = persist(records);
  const linkage = linkToPullRequests(records, persisted.ids);
  return summarize(snapshot, records, transport, persisted, linkage);
}

/** Live read from the local claude-mem worker, falling back to its SQLite store. */
export async function ingestClaudeMem(options: ClaudeMemIngestOptions = {}): Promise<ClaudeMemIngestResult> {
  const snapshot = await readSnapshot({ project: options.project, since: options.since, limit: options.limit });
  if (snapshot.transport === "none") {
    return ingestSnapshot({ observations: [], summaries: [], prompts: [] }, "none", options);
  }
  return ingestSnapshot(snapshot, snapshot.transport, options);
}

/** File/paste import parity with every other connector. */
export function ingestClaudeMemExport(content: string, options: ClaudeMemIngestOptions = {}) {
  let data: unknown;
  try { data = JSON.parse(content); }
  catch { throw new Error("claude-mem exports must be JSON containing observations, summaries, or prompts"); }
  const snapshot = snapshotFromExport(data);
  if (!snapshot.observations.length && !snapshot.summaries.length && !snapshot.prompts.length) {
    throw new Error("No claude-mem observations, summaries, or prompts found in this export");
  }
  return ingestSnapshot(snapshot, "export", options);
}
