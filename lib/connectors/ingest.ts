import type { ConnectorId } from "./catalog";
import { parseConnectorDump, type ParseContext } from "./parser";
import { ingestClaudeMemExport } from "../ingest/claude-mem";
import { getConnection, getGraphNodeBySource, listPullRequests, saveRawSourceRecord, upsertConnection, upsertGraphEdge, upsertGraphNode } from "../store";

const ticketPattern = /\b[A-Z][A-Z0-9]{1,9}-\d+\b/g;

const connectorNames: Record<ConnectorId, string> = {
  github: "GitHub", slack: "Slack", jira: "Jira", notion: "Notion", claude: "Claude Code", codex: "Codex", "claude-mem": "claude-mem",
};

export function ingestConnectorDump(source: ConnectorId, content: string, context: ParseContext = {}) {
  // claude-mem exports are already compressed records, not a transcript to parse.
  if (source === "claude-mem") {
    const result = ingestClaudeMemExport(content, { importedFrom: context.filename || "paste" });
    // Same shape as the parser path below: callers (lib/mcp/sync.ts) rely on
    // linkedPullRequestIds always being present, not on which branch produced it.
    return { source, records: result.nodes, edges: result.edges, nodeIds: [] as string[], linkedPullRequestIds: result.linkedPullRequests, claudeMem: result };
  }
  const records = parseConnectorDump(source, content, context);
  const connectionId = context.connectionId || source;
  const raw = saveRawSourceRecord({
    connectionId,
    syncRunId: context.syncRunId,
    source,
    remoteId: context.filename || `${source}-payload`,
    remoteRevision: context.importedAt,
    payload: content,
    metadata: { repository: context.repository, branch: context.branch },
  });
  const ids = new Map<string, string>();
  for (const record of records) ids.set(record.sourceId, upsertGraphNode(record));

  let edges = 0;
  for (const record of records) {
    const id = ids.get(record.sourceId);
    const parent = record.parentSourceId && ids.get(record.parentSourceId);
    if (id && parent) { upsertGraphEdge({ fromNodeId: parent, toNodeId: id, type: "PRECEDES", confidence: .95 }); edges++; }
  }

  /**
   * Correlate against pull requests already in the graph, not against whatever
   * happens to be inside this dump. A Slack or agent export never contains the PR,
   * so looking for the anchor in `records` meant imported evidence was never linked.
   */
  const linkedPullRequestIds = new Set<string>();
  for (const pr of listPullRequests()) {
    const anchor = getGraphNodeBySource("github", `${pr.repository}#${pr.number}`);
    if (!anchor) continue;
    const tickets = [...new Set(`${pr.title}\n${pr.body}`.match(ticketPattern) || [])];
    for (const record of records) {
      const id = ids.get(record.sourceId);
      if (!id || id === anchor.id) continue;
      const sameRepository = Boolean(record.repository) && record.repository === pr.repository;
      const branchAgrees = !record.branch || record.branch === pr.branch;
      const mentionsTicket = tickets.some((ticket) => `${record.title}\n${record.content}`.includes(ticket));
      const shaMatches = Boolean(record.commitSha) && record.commitSha === pr.headSha;
      if (!((sameRepository && branchAgrees) || mentionsTicket || shaMatches)) continue;
      upsertGraphEdge({
        fromNodeId: anchor.id,
        toNodeId: id,
        type: "CONTEXT_FOR",
        confidence: shaMatches ? 1 : mentionsTicket ? .9 : .85,
      });
      edges++;
      linkedPullRequestIds.add(pr.id);
    }
  }

  const existingConnection = getConnection(connectionId);
  upsertConnection({
    ...existingConnection,
    id: connectionId,
    source,
    name: existingConnection?.name || connectorNames[source],
    description: `${records.length} normalized records`,
    status: "connected",
    scope: context.repository || `${records.length} imported records`,
    lastSync: new Date().toISOString(),
  });
  return { source, records: records.length, edges, rawRecordId: raw.id, rawRecordInserted: raw.inserted, nodeIds: [...ids.values()], linkedPullRequestIds: [...linkedPullRequestIds] };
}
