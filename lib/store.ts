import { createHash, randomUUID } from "node:crypto";
import { getDb } from "./db";
import type { ArtifactPayload, Connection, PullRequestRecord } from "./types";
import type { GraphEdgeRecord, GraphNodeRecord } from "./graph";

type Json = Record<string, unknown>;

export type PullRequestInput = {
  id?: string;
  workspaceId?: string;
  repository: string;
  number: number;
  title: string;
  body?: string;
  author: string;
  branch: string;
  baseBranch: string;
  headSha?: string;
  status?: string;
  openedAt: string;
  updatedAt: string;
  artifactStatus?: PullRequestRecord["status"];
  metadata?: Json;
};

export type GraphNodeInput = Omit<GraphNodeRecord, "id" | "metadata" | "acl"> & {
  id?: string;
  workspaceId?: string;
  metadata?: Json;
  acl?: { policy: string; allowedSubjects: string[] };
};

export type GraphEdgeInput = GraphEdgeRecord & {
  id?: string;
  workspaceId?: string;
  evidenceNodeId?: string;
  metadata?: Json;
};

type Row = Record<string, string | number | null>;

const now = () => new Date().toISOString();
const json = (value: unknown) => JSON.stringify(value ?? {});
const parse = <T>(value: string | null | undefined, fallback: T): T => {
  if (!value) return fallback;
  try { return JSON.parse(value) as T; } catch { return fallback; }
};

export function ensureWorkspace(id = "acme", name = "Acme Engineering") {
  getDb().prepare(`
    INSERT INTO workspaces (id, name, created_at) VALUES (?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET name = excluded.name
  `).run(id, name, now());
  return { id, name };
}

export function upsertConnection(connection: Connection, workspaceId = "acme") {
  ensureWorkspace(workspaceId);
  getDb().prepare(`
    INSERT INTO connections (id, workspace_id, source, name, description, status, scope, last_sync, transport, server_url, auth_type, capabilities, configuration, sync_cursor, metadata)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(workspace_id, id) DO UPDATE SET
      source = excluded.source,
      name = excluded.name,
      description = excluded.description,
      status = excluded.status,
      scope = excluded.scope,
      last_sync = excluded.last_sync,
      transport = excluded.transport,
      server_url = excluded.server_url,
      auth_type = excluded.auth_type,
      capabilities = CASE WHEN excluded.capabilities = '{}' THEN connections.capabilities ELSE excluded.capabilities END,
      configuration = CASE WHEN excluded.configuration = '{}' THEN connections.configuration ELSE excluded.configuration END,
      sync_cursor = CASE WHEN excluded.sync_cursor = '{}' THEN connections.sync_cursor ELSE excluded.sync_cursor END,
      metadata = CASE WHEN excluded.metadata = '{}' THEN connections.metadata ELSE excluded.metadata END
  `).run(
    connection.id,
    workspaceId,
    connection.source || connection.id,
    connection.name,
    connection.description,
    connection.status,
    connection.scope,
    connection.lastSync || null,
    connection.transport || (connection.id === "github" ? "webhook" : connection.id === "claude" || connection.id === "codex" ? "file" : "rest"),
    connection.serverUrl || null,
    connection.authType || (connection.id === "claude" || connection.id === "codex" ? "none" : "environment"),
    json(connection.capabilities),
    json(connection.configuration),
    json(connection.syncCursor),
    json(connection.metadata),
  );
}

export function listConnections(workspaceId = "acme"): Connection[] {
  const rows = getDb().prepare(`
    SELECT id, source, name, description, status, scope, last_sync, transport, server_url, auth_type, capabilities, configuration, sync_cursor, metadata FROM connections
    WHERE workspace_id = ? ORDER BY rowid
  `).all(workspaceId) as Row[];
  return rows.map((row) => ({
    id: String(row.id),
    source: String(row.source),
    name: String(row.name),
    description: String(row.description),
    status: row.status as Connection["status"],
    scope: String(row.scope),
    lastSync: row.last_sync ? String(row.last_sync) : undefined,
    transport: String(row.transport) as Connection["transport"],
    serverUrl: row.server_url ? String(row.server_url) : undefined,
    authType: String(row.auth_type) as Connection["authType"],
    capabilities: parse<NonNullable<Connection["capabilities"]> | undefined>(row.capabilities as string, undefined),
    configuration: parse<Json>(row.configuration as string, {}),
    syncCursor: parse<Json>(row.sync_cursor as string, {}),
    metadata: parse<Json>(row.metadata as string, {}),
  }));
}

export function getConnection(id: string, workspaceId = "acme") {
  return listConnections(workspaceId).find((connection) => connection.id === id) || null;
}

export type SyncRun = {
  id: string; connectionId: string; status: "running" | "succeeded" | "failed";
  startedAt: string; completedAt?: string; recordsSeen: number; recordsWritten: number;
  error?: string; metadata: Json;
};

export function startSyncRun(connectionId: string, metadata: Json = {}, workspaceId = "acme") {
  ensureWorkspace(workspaceId);
  const id = randomUUID();
  getDb().prepare(`INSERT INTO sync_runs (id, workspace_id, connection_id, status, started_at, metadata) VALUES (?, ?, ?, 'running', ?, ?)`)
    .run(id, workspaceId, connectionId, now(), json(metadata));
  return id;
}

export function completeSyncRun(id: string, result: { recordsSeen?: number; recordsWritten?: number; error?: string }) {
  getDb().prepare(`UPDATE sync_runs SET status = ?, completed_at = ?, records_seen = ?, records_written = ?, error = ? WHERE id = ?`)
    .run(result.error ? "failed" : "succeeded", now(), result.recordsSeen || 0, result.recordsWritten || 0, result.error || null, id);
}

export function listSyncRuns(connectionId: string, workspaceId = "acme"): SyncRun[] {
  return (getDb().prepare(`SELECT * FROM sync_runs WHERE workspace_id = ? AND connection_id = ? ORDER BY started_at DESC`).all(workspaceId, connectionId) as Row[]).map((row) => ({
    id: String(row.id), connectionId: String(row.connection_id), status: String(row.status) as SyncRun["status"], startedAt: String(row.started_at),
    completedAt: row.completed_at ? String(row.completed_at) : undefined, recordsSeen: Number(row.records_seen), recordsWritten: Number(row.records_written),
    error: row.error ? String(row.error) : undefined, metadata: parse<Json>(row.metadata as string, {}),
  }));
}

export function saveRawSourceRecord(input: { connectionId: string; syncRunId?: string; source: string; remoteId: string; remoteRevision?: string; payload: unknown; metadata?: Json; workspaceId?: string }) {
  const workspaceId = input.workspaceId || "acme";
  ensureWorkspace(workspaceId);
  const serialized = JSON.stringify(input.payload);
  const contentHash = createHash("sha256").update(serialized).digest("hex");
  const existing = getDb().prepare(`SELECT id FROM raw_source_records WHERE workspace_id = ? AND connection_id = ? AND remote_id = ? AND content_hash = ?`)
    .get(workspaceId, input.connectionId, input.remoteId, contentHash) as Row | undefined;
  if (existing) return { id: String(existing.id), inserted: false, contentHash };
  const id = randomUUID();
  getDb().prepare(`INSERT INTO raw_source_records (id, workspace_id, connection_id, sync_run_id, source, remote_id, remote_revision, content_hash, payload, fetched_at, metadata) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(id, workspaceId, input.connectionId, input.syncRunId || null, input.source, input.remoteId, input.remoteRevision || null, contentHash, serialized, now(), json(input.metadata));
  return { id, inserted: true, contentHash };
}

export function upsertPullRequest(input: PullRequestInput) {
  const workspaceId = input.workspaceId || "acme";
  ensureWorkspace(workspaceId);
  const existing = getDb().prepare(`
    SELECT id FROM pull_requests WHERE workspace_id = ? AND repository = ? AND number = ?
  `).get(workspaceId, input.repository, input.number) as Row | undefined;
  const id = existing ? String(existing.id) : input.id || `pr-${input.number}`;

  getDb().prepare(`
    INSERT INTO pull_requests (
      id, workspace_id, repository, number, title, body, author, branch, base_branch,
      head_sha, status, opened_at, updated_at, artifact_status, metadata
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(workspace_id, repository, number) DO UPDATE SET
      title = excluded.title,
      body = excluded.body,
      author = excluded.author,
      branch = excluded.branch,
      base_branch = excluded.base_branch,
      head_sha = excluded.head_sha,
      status = excluded.status,
      updated_at = excluded.updated_at,
      artifact_status = excluded.artifact_status,
      metadata = excluded.metadata
  `).run(
    id,
    workspaceId,
    input.repository,
    input.number,
    input.title,
    input.body || "",
    input.author,
    input.branch,
    input.baseBranch,
    input.headSha || null,
    input.status || "open",
    input.openedAt,
    input.updatedAt,
    input.artifactStatus || "building",
    json(input.metadata),
  );
  return id;
}

export type StoredPullRequest = PullRequestInput & {
  id: string;
  workspaceId: string;
  artifactStatus: PullRequestRecord["status"];
};

function rowToPullRequest(row: Row): StoredPullRequest {
  return {
    id: String(row.id),
    workspaceId: String(row.workspace_id),
    repository: String(row.repository),
    number: Number(row.number),
    title: String(row.title),
    body: String(row.body || ""),
    author: String(row.author),
    branch: String(row.branch),
    baseBranch: String(row.base_branch),
    headSha: row.head_sha ? String(row.head_sha) : undefined,
    status: String(row.status),
    openedAt: String(row.opened_at),
    updatedAt: String(row.updated_at),
    artifactStatus: row.artifact_status as PullRequestRecord["status"],
    metadata: parse<Json>(row.metadata as string, {}),
  };
}

export function getPullRequest(id: string) {
  const row = getDb().prepare(`SELECT * FROM pull_requests WHERE id = ?`).get(id) as Row | undefined;
  return row ? rowToPullRequest(row) : null;
}

export function listPullRequests(workspaceId = "acme") {
  return (getDb().prepare(`
    SELECT * FROM pull_requests WHERE workspace_id = ? ORDER BY updated_at DESC
  `).all(workspaceId) as Row[]).map(rowToPullRequest);
}

export function setPullRequestArtifactStatus(id: string, status: PullRequestRecord["status"]) {
  getDb().prepare(`UPDATE pull_requests SET artifact_status = ?, updated_at = ? WHERE id = ?`).run(status, now(), id);
}

export function upsertGraphNode(input: GraphNodeInput) {
  const workspaceId = input.workspaceId || "acme";
  ensureWorkspace(workspaceId);
  const existing = getDb().prepare(`
    SELECT id FROM graph_nodes WHERE workspace_id = ? AND source = ? AND source_id = ?
  `).get(workspaceId, input.source, input.sourceId) as Row | undefined;
  const id = existing ? String(existing.id) : input.id || randomUUID();
  getDb().prepare(`
    INSERT INTO graph_nodes (
      id, workspace_id, type, source, source_id, title, content, occurred_at, actor_id,
      repository, branch, commit_sha, source_url, acl, metadata, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(workspace_id, source, source_id) DO UPDATE SET
      type = excluded.type,
      title = excluded.title,
      content = excluded.content,
      occurred_at = excluded.occurred_at,
      actor_id = excluded.actor_id,
      repository = excluded.repository,
      branch = excluded.branch,
      commit_sha = excluded.commit_sha,
      source_url = excluded.source_url,
      acl = excluded.acl,
      metadata = excluded.metadata
  `).run(
    id,
    workspaceId,
    input.type,
    input.source,
    input.sourceId,
    input.title,
    input.content,
    input.occurredAt,
    input.actorId || null,
    input.repository || null,
    input.branch || null,
    input.commitSha || null,
    input.sourceUrl || null,
    json(input.acl || { policy: "workspace", allowedSubjects: [] }),
    json(input.metadata),
    now(),
  );
  return id;
}

export function upsertGraphEdge(input: GraphEdgeInput) {
  const workspaceId = input.workspaceId || "acme";
  const id = input.id || randomUUID();
  getDb().prepare(`
    INSERT INTO graph_edges (
      id, workspace_id, from_node_id, to_node_id, type, confidence, evidence_node_id, metadata, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(workspace_id, from_node_id, to_node_id, type) DO UPDATE SET
      confidence = MAX(confidence, excluded.confidence),
      evidence_node_id = COALESCE(excluded.evidence_node_id, evidence_node_id),
      metadata = excluded.metadata
  `).run(
    id,
    workspaceId,
    input.fromNodeId,
    input.toNodeId,
    input.type,
    input.confidence,
    input.evidenceNodeId || null,
    json(input.metadata),
    now(),
  );
  return id;
}

function rowToNode(row: Row): GraphNodeRecord {
  return {
    id: String(row.id),
    type: String(row.type),
    source: String(row.source),
    sourceId: String(row.source_id),
    title: String(row.title),
    content: String(row.content || ""),
    occurredAt: String(row.occurred_at),
    actorId: row.actor_id ? String(row.actor_id) : undefined,
    repository: row.repository ? String(row.repository) : undefined,
    branch: row.branch ? String(row.branch) : undefined,
    commitSha: row.commit_sha ? String(row.commit_sha) : undefined,
    sourceUrl: row.source_url ? String(row.source_url) : undefined,
    acl: parse(row.acl as string, { policy: "workspace", allowedSubjects: [] }),
    metadata: parse<Json>(row.metadata as string, {}),
  };
}

export function listGraphNodes(workspaceId = "acme") {
  return (getDb().prepare(`
    SELECT * FROM graph_nodes WHERE workspace_id = ? ORDER BY occurred_at
  `).all(workspaceId) as Row[]).map(rowToNode);
}

export function getGraphNodeBySource(source: string, sourceId: string, workspaceId = "acme") {
  const row = getDb().prepare(`
    SELECT * FROM graph_nodes WHERE workspace_id = ? AND source = ? AND source_id = ?
  `).get(workspaceId, source, sourceId) as Row | undefined;
  return row ? rowToNode(row) : null;
}

export function getGraphNode(id: string) {
  const row = getDb().prepare(`SELECT * FROM graph_nodes WHERE id = ?`).get(id) as Row | undefined;
  return row ? rowToNode(row) : null;
}

export function listGraphEdges(workspaceId = "acme"): GraphEdgeRecord[] {
  return (getDb().prepare(`
    SELECT from_node_id, to_node_id, type, confidence FROM graph_edges WHERE workspace_id = ?
  `).all(workspaceId) as Row[]).map((row) => ({
    fromNodeId: String(row.from_node_id),
    toNodeId: String(row.to_node_id),
    type: String(row.type),
    confidence: Number(row.confidence),
  }));
}

export function saveArtifact(payload: ArtifactPayload, model?: string) {
  const pr = getPullRequest(payload.pullRequestId);
  if (!pr) throw new Error(`Unknown pull request ${payload.pullRequestId}`);
  const existing = getDb().prepare(`
    SELECT COALESCE(MAX(version), 0) AS version FROM artifacts WHERE pull_request_id = ?
  `).get(payload.pullRequestId) as Row;
  const version = Math.max(Number(existing.version) + 1, payload.version || 1);
  const id = `${payload.pullRequestId}-v${version}`;
  const stored = { ...payload, id, version };
  getDb().prepare(`
    INSERT INTO artifacts (id, workspace_id, pull_request_id, version, status, summary, payload, generated_at, model)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, pr.workspaceId, pr.id, version, stored.status, stored.summary, json(stored), stored.generatedAt, model || null);
  setPullRequestArtifactStatus(pr.id, stored.status === "ready" ? "ready" : "limited");
  return stored;
}

export function getLatestArtifact(pullRequestId: string): ArtifactPayload | null {
  const row = getDb().prepare(`
    SELECT payload FROM artifacts WHERE pull_request_id = ? ORDER BY version DESC LIMIT 1
  `).get(pullRequestId) as Row | undefined;
  return row ? parse<ArtifactPayload>(row.payload as string, null as unknown as ArtifactPayload) : null;
}

export function countArtifacts(pullRequestId: string) {
  const row = getDb().prepare(`SELECT COUNT(*) AS count FROM artifacts WHERE pull_request_id = ?`).get(pullRequestId) as Row;
  return Number(row.count);
}

export function graphStats(workspaceId = "acme") {
  const nodeCount = getDb().prepare(`SELECT COUNT(*) AS count FROM graph_nodes WHERE workspace_id = ?`).get(workspaceId) as Row;
  const linked = getDb().prepare(`SELECT COUNT(DISTINCT to_node_id) AS count FROM graph_edges WHERE workspace_id = ?`).get(workspaceId) as Row;
  const unlinkedClaude = getDb().prepare(`
    SELECT COUNT(*) AS count FROM graph_nodes n
    WHERE n.workspace_id = ? AND n.source = 'claude'
      AND NOT EXISTS (SELECT 1 FROM graph_edges e WHERE e.workspace_id = n.workspace_id AND (e.from_node_id = n.id OR e.to_node_id = n.id))
  `).get(workspaceId) as Row;
  return {
    records: Number(nodeCount.count),
    linkedRecords: Number(linked.count),
    unlinkedSessions: Number(unlinkedClaude.count),
  };
}

export function recordWebhookDelivery(id: string, provider: string, eventType: string) {
  try {
    getDb().prepare(`
      INSERT INTO webhook_deliveries (id, provider, event_type, received_at, status) VALUES (?, ?, ?, ?, 'processing')
    `).run(id, provider, eventType, now());
    return true;
  } catch (error) {
    if (String(error).includes("UNIQUE constraint failed")) return false;
    throw error;
  }
}

export function completeWebhookDelivery(id: string, error?: string) {
  getDb().prepare(`
    UPDATE webhook_deliveries SET status = ?, error = ? WHERE id = ?
  `).run(error ? "failed" : "complete", error || null, id);
}
