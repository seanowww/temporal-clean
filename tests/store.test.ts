import test from "node:test";
import assert from "node:assert/strict";

process.env.TEMPORAL_DB_PATH = ":memory:";
const store = await import("../lib/store");

test("store deduplicates nodes and webhook deliveries", () => {
  const nodeInput = {
    type: "agent_session",
    source: "claude",
    sourceId: "session-1",
    title: "First title",
    content: "decision",
    occurredAt: "2026-08-21T10:00:00.000Z",
    repository: "acme/api",
    branch: "feature/export",
  };
  const first = store.upsertGraphNode(nodeInput);
  const second = store.upsertGraphNode({ ...nodeInput, title: "Updated title" });

  assert.equal(first, second);
  assert.equal(store.listGraphNodes().length, 1);
  assert.equal(store.listGraphNodes()[0].title, "Updated title");
  assert.equal(store.recordWebhookDelivery("delivery-1", "github", "pull_request"), true);
  assert.equal(store.recordWebhookDelivery("delivery-1", "github", "pull_request"), false);
});

test("store versions artifacts monotonically", () => {
  store.upsertPullRequest({
    id: "pr-9",
    repository: "acme/api",
    number: 9,
    title: "Test PR",
    author: "aria",
    branch: "feature/test",
    baseBranch: "main",
    openedAt: "2026-08-21T10:00:00.000Z",
    updatedAt: "2026-08-21T10:00:00.000Z",
  });
  const base = {
    id: "ignored",
    pullRequestId: "pr-9",
    version: 1,
    status: "ready" as const,
    generatedAt: "2026-08-21T10:01:00.000Z",
    summary: "summary",
    events: [],
    edges: [],
    coverage: [],
  };
  assert.equal(store.saveArtifact(base).version, 1);
  assert.equal(store.saveArtifact(base).version, 2);
  assert.equal(store.getLatestArtifact("pr-9")?.version, 2);
});

test("connection updates preserve GitHub App installation metadata", () => {
  store.upsertConnection({ id: "github", name: "GitHub", description: "GitHub", status: "connected", scope: "acme", metadata: { installationId: 42, accountLogin: "acme" } });
  store.upsertConnection({ id: "github", name: "GitHub", description: "GitHub", status: "connected", scope: "acme/repo", lastSync: "just now" });
  const connection = store.listConnections().find((entry) => entry.id === "github");
  assert.equal(connection?.metadata?.installationId, 42);
  assert.equal(connection?.scope, "acme/repo");
});

test("connections can share a source while retaining distinct transports", () => {
  store.upsertConnection({ id: "notion-rest", source: "notion", name: "Notion API", description: "REST", status: "connected", scope: "workspace-a", transport: "rest", authType: "environment" });
  store.upsertConnection({ id: "notion-mcp", source: "notion", name: "Notion MCP", description: "MCP", status: "connected", scope: "workspace-b", transport: "mcp-http", authType: "oauth", serverUrl: "https://mcp.notion.com/mcp" });
  const notion = store.listConnections().filter((connection) => connection.source === "notion");
  assert.equal(notion.length, 2);
  assert.deepEqual(new Set(notion.map((connection) => connection.transport)), new Set(["rest", "mcp-http"]));
});

test("sync runs and raw source payloads are replay safe", () => {
  store.upsertConnection({ id: "slack-mcp", source: "slack", name: "Slack MCP", description: "MCP", status: "connected", scope: "approved", transport: "mcp-http", authType: "oauth" });
  const run = store.startSyncRun("slack-mcp", { tool: "search" });
  const first = store.saveRawSourceRecord({ connectionId: "slack-mcp", syncRunId: run, source: "slack", remoteId: "thread-1", payload: { text: "decision" } });
  const replay = store.saveRawSourceRecord({ connectionId: "slack-mcp", syncRunId: run, source: "slack", remoteId: "thread-1", payload: { text: "decision" } });
  store.completeSyncRun(run, { recordsSeen: 1, recordsWritten: 1 });
  assert.equal(first.inserted, true);
  assert.equal(replay.inserted, false);
  assert.equal(store.listSyncRuns("slack-mcp")[0].status, "succeeded");
});
