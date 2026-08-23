import test from "node:test";
import assert from "node:assert/strict";
import { parseCommittedEvidence, prepareCommittedEvidence } from "../lib/committed-evidence";
import type { GraphNodeRecord } from "../lib/graph";

const node = (value: Partial<GraphNodeRecord> & Pick<GraphNodeRecord, "id" | "source" | "sourceId">): GraphNodeRecord => ({
  type: "decision",
  title: "Retry decision",
  content: "Preserve job-level idempotency.",
  occurredAt: "2026-08-21T18:00:00.000Z",
  repository: "acme/platform-api",
  branch: "feature/export",
  acl: { policy: "workspace", allowedSubjects: [] },
  metadata: {},
  ...value,
});

test("committed evidence is repository scoped, privacy stripped, and metadata allowlisted", () => {
  const prepared = prepareCommittedEvidence([
    node({ id: "safe", source: "claude", sourceId: "session-1", title: "Use retries <private>customer name</private>", metadata: { filesModified: ["lib/jobs.ts"], accessToken: "never-export" } }),
    node({ id: "restricted", source: "slack", sourceId: "message-1", acl: { policy: "source-members", allowedSubjects: ["slack:C1"] } }),
    node({ id: "other", source: "notion", sourceId: "page-1", repository: "acme/other" }),
    node({ id: "synthetic", source: "jira", sourceId: "issue-1", metadata: { synthetic: true } }),
    node({ id: "github", source: "github", sourceId: "pr-1", type: "pull_request" }),
  ], [], "acme/platform-api", "2026-08-23T00:00:00.000Z");

  assert.equal(prepared.nodes.length, 1);
  assert.equal(prepared.nodes[0].title, "Use retries");
  assert.deepEqual(prepared.nodes[0].metadata, { filesModified: ["lib/jobs.ts"] });
  assert.deepEqual(prepared.manifest.excluded, { restricted: 1, synthetic: 1, otherRepository: 1 });
  assert.doesNotMatch(prepared.recordsJsonl, /customer name|never-export/);
  assert.equal(parseCommittedEvidence(prepared.recordsJsonl, prepared.edgesJsonl, prepared.manifest.digest).nodes.length, 1);
});

test("committed evidence rejects tampering and credential-shaped content", () => {
  const prepared = prepareCommittedEvidence([node({ id: "safe", source: "claude", sourceId: "session-1" })], [], "acme/platform-api");
  assert.throws(() => parseCommittedEvidence(`${prepared.recordsJsonl} `, prepared.edgesJsonl, prepared.manifest.digest), /digest/);
  const credential = `${JSON.stringify({ ...prepared.nodes[0], content: "github_pat_abcdefghijklmnopqrstuvwxyz123456" })}\n`;
  assert.throws(() => parseCommittedEvidence(credential, ""), /credential/);
});
