import test from "node:test";
import assert from "node:assert/strict";
import { parseConnectorDump } from "../lib/connectors/parser";

const context = { repository: "acme/platform-api", branch: "feature/export", importedAt: "2026-08-21T20:00:00.000Z" };

test("Slack exports preserve threads and source identity", () => {
  const records = parseConnectorDump("slack", JSON.stringify({ channels: [{ id: "C1", name: "exports", messages: [
    { ts: "1755800000.000100", user: "U1", text: "EXP-42 needs job idempotency" },
    { ts: "1755800010.000100", thread_ts: "1755800000.000100", user: "U2", text: "Agreed" },
  ] }] }), context);
  assert.equal(records.length, 2);
  assert.equal(records[1].parentSourceId, records[0].sourceId);
  assert.equal(records[0].source, "slack");
});

test("Jira, Notion, and chat dumps normalize to graph records", () => {
  const jira = parseConnectorDump("jira", JSON.stringify({ issues: [{ key: "EXP-42", fields: { summary: "Retry-safe exports", description: "Use job keys", updated: "2026-08-21T12:00:00Z" } }] }), context);
  const notion = parseConnectorDump("notion", JSON.stringify({ results: [{ id: "page-1", title: "Export plan", last_edited_time: "2026-08-20T12:00:00Z", url: "https://notion.so/page" }] }), context);
  const codex = parseConnectorDump("codex", '{"role":"user","content":"inspect EXP-42"}\n{"role":"assistant","content":"found retry drift"}', context);
  assert.equal(jira[0].sourceId, "EXP-42");
  assert.equal(notion[0].title, "Export plan");
  // A transcript rolls up: one session event, then the individual turns as detail.
  assert.equal(codex.length, 3);
  assert.equal(codex[0].type, "agent_session");
  assert.equal(codex[0].title, "inspect EXP-42");
  assert.deepEqual(codex.slice(1).map((record) => record.type), ["message", "message"]);
  assert.ok(codex.slice(1).every((record) => record.parentSourceId === codex[0].sourceId));
});

test("every source keeps the import provenance the connection history groups by", () => {
  const named = { ...context, filename: "exports-thread.json" };
  const sources = [
    parseConnectorDump("slack", JSON.stringify({ channels: [{ id: "C1", messages: [{ ts: "1755800000.000100", text: "hi" }] }] }), named),
    parseConnectorDump("jira", JSON.stringify({ issues: [{ key: "EXP-42", fields: { summary: "s" } }] }), named),
    parseConnectorDump("notion", JSON.stringify({ results: [{ id: "p1", title: "t" }] }), named),
    parseConnectorDump("github", JSON.stringify({ commits: [{ sha: "abc123", message: "fix" }] }), named),
    parseConnectorDump("claude", JSON.stringify({ sessionId: "s1", messages: [{ role: "user", content: "why" }] }), named),
  ];
  for (const records of sources) {
    assert.ok(records.length, "each fixture must produce at least one record");
    for (const record of records) {
      const metadata = record.metadata as Record<string, unknown>;
      assert.equal(metadata.importedFrom, "exports-thread.json");
      assert.equal(metadata.importedAt, context.importedAt);
    }
  }
});

test("source-specific metadata still wins over the import provenance defaults", () => {
  const [record] = parseConnectorDump("jira", JSON.stringify({ issues: [{ key: "EXP-42", fields: { summary: "s", status: { name: "Done" } } }] }), { ...context, filename: "jira.json" });
  const metadata = record.metadata as Record<string, unknown>;
  assert.equal(metadata.ticketId, "EXP-42");
  assert.equal(metadata.status, "Done");
  assert.equal(metadata.importedFrom, "jira.json");
});

test("GitHub API records retain repository and branch identity", () => {
  const records = parseConnectorDump("github", JSON.stringify({ pull_requests: [{ id: 9, number: 17, title: "Retry exports", repository: { full_name: "acme/api" }, head: { ref: "feature/retry" } }] }), { ...context, repository: undefined, branch: undefined });
  assert.equal(records[0].sourceId, "acme/api#17");
  assert.equal(records[0].repository, "acme/api");
  assert.equal(records[0].branch, "feature/retry");
});
