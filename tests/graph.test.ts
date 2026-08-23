import test from "node:test";
import assert from "node:assert/strict";
import { canAccessNode, traverseGraph, type GraphEdgeRecord, type GraphNodeRecord } from "../lib/graph";

const openedAt = "2026-08-21T20:00:00.000Z";
const acl = { policy: "workspace", allowedSubjects: [] };
const record = (value: Partial<GraphNodeRecord> & Pick<GraphNodeRecord, "id" | "source" | "sourceId">): GraphNodeRecord => ({
  type: "message", title: value.sourceId, content: "", occurredAt: "2026-08-20T20:00:00.000Z", acl, metadata: {}, ...value,
});
const nodes: GraphNodeRecord[] = [
  { id: "pr", type: "pull_request", source: "github", sourceId: "pr-1", title: "PR", content: "", occurredAt: openedAt, repository: "acme/api", branch: "feature/export", acl, metadata: {} },
  { id: "session", type: "agent_session", source: "claude", sourceId: "s-1", title: "Retry decision", content: "Use job-level idempotency for EXP-42", occurredAt: "2026-08-20T20:00:00.000Z", actorId: "aria", repository: "acme/api", branch: "feature/export", acl, metadata: {} },
  { id: "slack", type: "message", source: "slack", sourceId: "m-1", title: "Approval", content: "Approved for EXP-42", occurredAt: "2026-08-20T21:00:00.000Z", repository: "acme/api", acl, metadata: {} },
  { id: "noise", type: "message", source: "slack", sourceId: "m-2", title: "Other project", content: "pagination", occurredAt: "2026-08-20T21:00:00.000Z", repository: "other/repo", acl, metadata: {} },
];
const edges: GraphEdgeRecord[] = [
  { fromNodeId: "pr", toNodeId: "session", type: "DERIVED_FROM", confidence: 1 },
  { fromNodeId: "session", toNodeId: "slack", type: "APPROVED_IN", confidence: .9 },
];

test("bounded traversal prioritizes graph-connected and deterministic matches", () => {
  const result = traverseGraph({
    nodeId: "pr",
    repository: "acme/api",
    branch: "feature/export",
    author: "aria",
    openedAt,
    ticketIds: ["EXP-42"],
  }, nodes, edges);

  assert.deepEqual(result.map((candidate) => candidate.node.id), ["session", "slack"]);
  assert.ok(result[0].reasons.includes("matching branch"));
  assert.ok(result[1].reasons.includes("mentions EXP-42"));
});

test("source-scoped nodes require a matching viewer subject", () => {
  const restricted = { ...nodes[1], acl: { policy: "source-members", allowedSubjects: ["slack:C123", "user:aria"] } };
  assert.equal(canAccessNode(restricted, ["user:aria"]), true);
  assert.equal(canAccessNode(restricted, ["user:marcus"]), false);
  assert.equal(canAccessNode(nodes[0], []), true);
});

test("bounded traversal rejects semantically similar records from another repository", () => {
  const result = traverseGraph({
    nodeId: "pr",
    repository: "acme/api",
    branch: "feature/export",
    author: "aria",
    openedAt,
    ticketIds: [],
  }, nodes, edges, { minimumScore: 1 });

  assert.equal(result.some((candidate) => candidate.node.id === "noise"), false);
});

test("same-repository evidence attached to another branch stays out of the PR", () => {
  const nodes = [
    record({ id: "pr", source: "github", sourceId: "acme/api#12", repository: "acme/api", branch: "feature/waitlist" }),
    record({ id: "current", source: "slack", sourceId: "current", repository: "acme/api", branch: "feature/waitlist", title: "WL-12 privacy review" }),
    record({ id: "other", source: "github", sourceId: "other", repository: "acme/api", branch: "feature/exports", title: "Unrelated export implementation" }),
  ];
  const result = traverseGraph({
    nodeId: "pr", repository: "acme/api", branch: "feature/waitlist", author: "johnny",
    openedAt: "2026-08-23T20:00:00.000Z", ticketIds: ["WL-12"],
  }, nodes, [], { minimumScore: 25 });
  assert.deepEqual(result.map((candidate) => candidate.node.id), ["current"]);
});
