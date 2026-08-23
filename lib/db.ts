import { mkdirSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

declare global {
  var __temporalDb: DatabaseSync | undefined;
}

function initialize(db: DatabaseSync) {
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;

    CREATE TABLE IF NOT EXISTS workspaces (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      created_at TEXT NOT NULL
    ) STRICT;

    CREATE TABLE IF NOT EXISTS connections (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      source TEXT NOT NULL,
      name TEXT NOT NULL,
      description TEXT NOT NULL,
      status TEXT NOT NULL,
      scope TEXT NOT NULL,
      last_sync TEXT,
      transport TEXT NOT NULL DEFAULT 'file',
      server_url TEXT,
      auth_type TEXT NOT NULL DEFAULT 'none',
      capabilities TEXT NOT NULL DEFAULT '{}',
      configuration TEXT NOT NULL DEFAULT '{}',
      sync_cursor TEXT NOT NULL DEFAULT '{}',
      metadata TEXT NOT NULL DEFAULT '{}',
      UNIQUE(workspace_id, id)
    ) STRICT;

    CREATE TABLE IF NOT EXISTS sync_runs (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      connection_id TEXT NOT NULL,
      status TEXT NOT NULL,
      started_at TEXT NOT NULL,
      completed_at TEXT,
      records_seen INTEGER NOT NULL DEFAULT 0,
      records_written INTEGER NOT NULL DEFAULT 0,
      error TEXT,
      metadata TEXT NOT NULL DEFAULT '{}'
    ) STRICT;

    CREATE TABLE IF NOT EXISTS raw_source_records (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      connection_id TEXT NOT NULL,
      sync_run_id TEXT REFERENCES sync_runs(id) ON DELETE SET NULL,
      source TEXT NOT NULL,
      remote_id TEXT NOT NULL,
      remote_revision TEXT,
      content_hash TEXT NOT NULL,
      payload TEXT NOT NULL,
      fetched_at TEXT NOT NULL,
      metadata TEXT NOT NULL DEFAULT '{}',
      UNIQUE(workspace_id, connection_id, remote_id, content_hash)
    ) STRICT;

    CREATE TABLE IF NOT EXISTS pull_requests (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      repository TEXT NOT NULL,
      number INTEGER NOT NULL,
      title TEXT NOT NULL,
      body TEXT NOT NULL DEFAULT '',
      author TEXT NOT NULL,
      branch TEXT NOT NULL,
      base_branch TEXT NOT NULL,
      head_sha TEXT,
      status TEXT NOT NULL,
      opened_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      artifact_status TEXT NOT NULL DEFAULT 'building',
      metadata TEXT NOT NULL DEFAULT '{}',
      UNIQUE(workspace_id, repository, number)
    ) STRICT;

    CREATE TABLE IF NOT EXISTS graph_nodes (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      type TEXT NOT NULL,
      source TEXT NOT NULL,
      source_id TEXT NOT NULL,
      title TEXT NOT NULL,
      content TEXT NOT NULL DEFAULT '',
      occurred_at TEXT NOT NULL,
      actor_id TEXT,
      repository TEXT,
      branch TEXT,
      commit_sha TEXT,
      source_url TEXT,
      acl TEXT NOT NULL DEFAULT '{"policy":"workspace","allowedSubjects":[]}',
      metadata TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL,
      UNIQUE(workspace_id, source, source_id)
    ) STRICT;

    CREATE TABLE IF NOT EXISTS graph_edges (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      from_node_id TEXT NOT NULL REFERENCES graph_nodes(id) ON DELETE CASCADE,
      to_node_id TEXT NOT NULL REFERENCES graph_nodes(id) ON DELETE CASCADE,
      type TEXT NOT NULL,
      confidence REAL NOT NULL,
      evidence_node_id TEXT REFERENCES graph_nodes(id) ON DELETE SET NULL,
      metadata TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL,
      UNIQUE(workspace_id, from_node_id, to_node_id, type)
    ) STRICT;

    CREATE TABLE IF NOT EXISTS artifacts (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      pull_request_id TEXT NOT NULL REFERENCES pull_requests(id) ON DELETE CASCADE,
      version INTEGER NOT NULL,
      status TEXT NOT NULL,
      summary TEXT NOT NULL,
      payload TEXT NOT NULL,
      generated_at TEXT NOT NULL,
      model TEXT,
      UNIQUE(pull_request_id, version)
    ) STRICT;

    CREATE TABLE IF NOT EXISTS webhook_deliveries (
      id TEXT PRIMARY KEY,
      provider TEXT NOT NULL,
      event_type TEXT NOT NULL,
      received_at TEXT NOT NULL,
      status TEXT NOT NULL,
      error TEXT
    ) STRICT;

    CREATE INDEX IF NOT EXISTS idx_nodes_workspace_time ON graph_nodes(workspace_id, occurred_at);
    CREATE INDEX IF NOT EXISTS idx_nodes_repository ON graph_nodes(workspace_id, repository);
    CREATE INDEX IF NOT EXISTS idx_nodes_branch ON graph_nodes(workspace_id, branch);
    CREATE INDEX IF NOT EXISTS idx_nodes_commit ON graph_nodes(workspace_id, commit_sha);
    CREATE INDEX IF NOT EXISTS idx_edges_from ON graph_edges(workspace_id, from_node_id);
    CREATE INDEX IF NOT EXISTS idx_edges_to ON graph_edges(workspace_id, to_node_id);
    CREATE INDEX IF NOT EXISTS idx_artifacts_pr ON artifacts(pull_request_id, version DESC);
    CREATE INDEX IF NOT EXISTS idx_connections_source ON connections(workspace_id, source);
    CREATE INDEX IF NOT EXISTS idx_sync_runs_connection ON sync_runs(workspace_id, connection_id, started_at DESC);
    CREATE INDEX IF NOT EXISTS idx_raw_records_connection ON raw_source_records(workspace_id, connection_id, fetched_at DESC);
  `);

  // Databases created before MCP support used one connection per source and did
  // not carry transport details. Rebuild only that table, retaining legacy IDs.
  const columns = db.prepare("PRAGMA table_info(connections)").all() as Array<{ name: string }>;
  if (!columns.some((column) => column.name === "transport")) {
    db.exec(`
      ALTER TABLE connections RENAME TO connections_legacy;
      CREATE TABLE connections (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
        source TEXT NOT NULL,
        name TEXT NOT NULL,
        description TEXT NOT NULL,
        status TEXT NOT NULL,
        scope TEXT NOT NULL,
        last_sync TEXT,
        transport TEXT NOT NULL DEFAULT 'file',
        server_url TEXT,
        auth_type TEXT NOT NULL DEFAULT 'none',
        capabilities TEXT NOT NULL DEFAULT '{}',
        configuration TEXT NOT NULL DEFAULT '{}',
        sync_cursor TEXT NOT NULL DEFAULT '{}',
        metadata TEXT NOT NULL DEFAULT '{}',
        UNIQUE(workspace_id, id)
      ) STRICT;
      INSERT INTO connections (id, workspace_id, source, name, description, status, scope, last_sync, transport, auth_type, metadata)
      SELECT id, workspace_id, source, name, description, status, scope, last_sync,
        CASE WHEN source IN ('claude', 'codex') THEN 'file' WHEN source = 'github' THEN 'webhook' ELSE 'rest' END,
        CASE WHEN source IN ('claude', 'codex') THEN 'none' ELSE 'environment' END,
        metadata
      FROM connections_legacy;
      DROP TABLE connections_legacy;
      CREATE INDEX IF NOT EXISTS idx_connections_source ON connections(workspace_id, source);
    `);
  }
}

export function getDb() {
  if (globalThis.__temporalDb) return globalThis.__temporalDb;

  const configured = process.env.TEMPORAL_DB_PATH;
  const databasePath = configured === ":memory:"
    ? configured
    : configured
      ? path.resolve(/* turbopackIgnore: true */ configured)
      : path.join(process.cwd(), "data", "temporal.db");

  if (databasePath !== ":memory:") mkdirSync(path.dirname(databasePath), { recursive: true });
  const db = new DatabaseSync(databasePath, { timeout: 5_000 });
  initialize(db);
  globalThis.__temporalDb = db;
  return db;
}

export function resetDbForTests() {
  globalThis.__temporalDb?.close();
  globalThis.__temporalDb = undefined;
}
