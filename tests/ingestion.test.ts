import test from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";

process.env.TEMPORAL_DB_PATH = ":memory:";
const { ingestGitHubWebhook } = await import("../lib/ingest/github");
const { ingestClaudeSession } = await import("../lib/ingest/claude");
const { assembleArtifact } = await import("../lib/artifact");
const { buildGitHubCheckPayload, buildGitHubCommentBody, buildGitHubDeploymentPayload, buildGitHubDeploymentStatusPayload } = await import("../lib/delivery");
const { verifyGitHubSignature } = await import("../lib/security");
const { getPullRequest, listConnections, listGraphEdges, listGraphNodes, getGraphNodeBySource } = await import("../lib/store");
const { ingestConnectorDump } = await import("../lib/connectors/ingest");

const pullRequestPayload = {
  action: "opened",
  repository: { full_name: "acme/platform-api", html_url: "https://github.com/acme/platform-api" },
  pull_request: {
    number: 101,
    title: "EXP-42 make exports retry-safe",
    body: "Implements EXP-42",
    html_url: "https://github.com/acme/platform-api/pull/101",
    state: "open",
    created_at: "2026-08-21T20:00:00.000Z",
    updated_at: "2026-08-21T20:00:00.000Z",
    user: { login: "aria" },
    head: { ref: "feature/export", sha: "abc123" },
    base: { ref: "main" },
    changed_files: 3,
    additions: 41,
    deletions: 9,
    commits: 2,
  },
};

test("GitHub PR and Claude session form a traversable provenance chain", async () => {
  const github = ingestGitHubWebhook("delivery-pr-101", "pull_request", pullRequestPayload);
  assert.equal(github.duplicate, false);
  const pr = getPullRequest("pr-101");
  assert.equal(pr?.repository, "acme/platform-api");
  assert.equal(pr?.branch, "feature/export");
  assert.equal(pr?.baseBranch, "main");
  assert.equal(pr?.headSha, "abc123");
  assert.equal(pr?.title, "EXP-42 make exports retry-safe");
  assert.equal(pr?.body, "Implements EXP-42");
  assert.equal(pr?.author, "aria");
  assert.deepEqual({ files: pr?.metadata?.filesChanged, additions: pr?.metadata?.additions, deletions: pr?.metadata?.deletions, commits: pr?.metadata?.commitCount }, { files: 3, additions: 41, deletions: 9, commits: 2 });

  const claude = ingestClaudeSession({
    sessionId: "claude-session-101",
    repository: "acme/platform-api",
    branch: "feature/export",
    actor: "aria",
    startedAt: "2026-08-20T20:00:00.000Z",
    messages: [
      { role: "user", content: "Why do retries duplicate rows for EXP-42?" },
      { role: "assistant", content: "Use job-level idempotency because shard-local cursors move during rebalance." },
    ],
    commitShas: ["abc123"],
  });
  assert.deepEqual(claude.linkedPullRequests, ["pr-101"]);
  assert.ok(listGraphEdges().some((edge) => edge.type === "DERIVED_FROM"));

  const artifact = await assembleArtifact("pr-101", { useAi: false });
  assert.equal(artifact.status, "ready");
  assert.ok(artifact.events.some((event) => event.src === "claude"));
  assert.ok(artifact.summary.includes("Why do retries"));
  const claudeEvent = artifact.events.find((event) => event.src === "claude" && event.title === "Why do retries duplicate rows for EXP-42?");
  assert.deepEqual(claudeEvent?.tests, ["Inspect the diff for the agent-session decision or constraint: Why do retries duplicate rows for EXP-42."]);
  assert.equal(listGraphNodes().filter((node) => node.source === "claude").length, 3);

  const delivery = buildGitHubCheckPayload(pr!, artifact);
  assert.equal(delivery.head_sha, "abc123");
  assert.match(delivery.details_url, /artifact\/index\.html\?artifact=pr-101/);
  assert.equal(delivery.output.title, "Timeline ready");
  const comment = buildGitHubCommentBody(pr!, artifact);
  assert.match(comment, /^<!-- temporal-artifact -->/, "the marker must lead so the comment can be found and edited in place");
  assert.doesNotMatch(comment, /<details>/);
  assert.match(comment, /Temporal timeline ready/);
  assert.match(comment, /View timeline/);
  assert.match(comment, /`abc123`/);
  assert.match(comment, /artifact\/index\.html\?artifact=pr-101/);

  const deployment = buildGitHubDeploymentPayload(pr!);
  assert.equal(deployment.ref, "abc123");
  assert.equal(deployment.task, "temporal");
  assert.equal(deployment.environment, "Temporal / PR #101");
  assert.equal(deployment.transient_environment, true);
  const deploymentStatus = buildGitHubDeploymentStatusPayload(pr!);
  assert.equal(deploymentStatus.state, "success");
  assert.match(deploymentStatus.environment_url, /artifact\/index\.html\?artifact=pr-101/);
});

test("GitHub ingestion and signature verification are replay safe", () => {
  const duplicate = ingestGitHubWebhook("delivery-pr-101", "pull_request", pullRequestPayload);
  assert.equal(duplicate.duplicate, true);

  const body = JSON.stringify(pullRequestPayload);
  const secret = "test-secret";
  const signature = `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`;
  assert.equal(verifyGitHubSignature(body, signature, secret), true);
  assert.equal(verifyGitHubSignature(`${body}x`, signature, secret), false);
});

test("GitHub installation webhooks keep repository authorization current", () => {
  ingestGitHubWebhook("delivery-install-1", "installation", { action: "created", installation: { id: 77, account: { login: "acme", type: "Organization" }, repository_selection: "selected" }, repositories: [{ full_name: "acme/api" }, { full_name: "acme/web" }] });
  let connection = listConnections().find((entry) => entry.id === "github");
  assert.equal(connection?.metadata?.installationId, 77);
  assert.equal(connection?.metadata?.repositoryCount, 2);
  ingestGitHubWebhook("delivery-install-2", "installation_repositories", { action: "removed", installation: { id: 77, account: { login: "acme", type: "Organization" }, repository_selection: "selected" }, repositories_removed: [{ full_name: "acme/web" }] });
  connection = listConnections().find((entry) => entry.id === "github");
  assert.deepEqual(connection?.metadata?.repositories, ["acme/api"]);
});

test("an imported Slack export links to a pull request already in the graph", () => {
  ingestGitHubWebhook("delivery-pr-303", "pull_request", {
    action: "opened",
    repository: { full_name: "acme/platform-api" },
    pull_request: {
      number: 303, title: "EXP-99 stabilise exports", body: "Closes EXP-99",
      state: "open", created_at: "2026-08-21T20:00:00.000Z", updated_at: "2026-08-21T20:00:00.000Z",
      user: { login: "aria" }, head: { ref: "aria/exp-99", sha: "sha303" }, base: { ref: "main" },
    },
  });
  const anchor = getGraphNodeBySource("github", "acme/platform-api#303");
  assert.ok(anchor, "the PR anchor must exist before the import");

  const result = ingestConnectorDump("slack", JSON.stringify({ channels: [{ id: "C9", name: "exports", messages: [
    { ts: "1755800000.000900", user: "priya", text: "EXP-99 exports still truncate at 10k rows" },
  ] }] }), { repository: "acme/platform-api", branch: "aria/exp-99", filename: "slack.json", importedAt: "2026-08-21T18:00:00.000Z" });

  assert.equal(result.records, 1);
  assert.ok(result.edges >= 1, "the import must create at least one edge to the PR anchor");
  assert.deepEqual(result.linkedPullRequestIds, ["pr-303"]);
  const linked = listGraphEdges().some((edge) => edge.fromNodeId === anchor!.id && edge.type === "CONTEXT_FOR");
  assert.ok(linked, "a CONTEXT_FOR edge must run from the stored PR anchor to the imported evidence");
});
