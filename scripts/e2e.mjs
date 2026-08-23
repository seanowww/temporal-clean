import assert from "node:assert/strict";
import { createHmac, randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";

const endpoint = process.env.TEMPORAL_ENDPOINT || "http://localhost:3010";
const webhookSecret = process.env.GITHUB_WEBHOOK_SECRET || "e2e-secret";
const collectorToken = process.env.TEMPORAL_COLLECTOR_TOKEN || "e2e-collector";
const fixturePath = new URL("../tests/fixtures/github-pr-opened.json", import.meta.url);
const sessionPath = new URL("../tests/fixtures/claude-session.jsonl", import.meta.url);
const body = await readFile(fixturePath, "utf8");
const signature = `sha256=${createHmac("sha256", webhookSecret).update(body).digest("hex")}`;
const deliveryId = `e2e-delivery-${randomUUID()}`;

const webhook = await fetch(`${endpoint}/api/webhooks/github`, {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    "X-GitHub-Event": "pull_request",
    "X-GitHub-Delivery": deliveryId,
    "X-Hub-Signature-256": signature,
  },
  body,
});
const webhookText = await webhook.text();
assert.equal(webhook.status, 202, webhookText);
const webhookResult = JSON.parse(webhookText);
assert.equal(webhookResult.verified, true);
assert.equal(webhookResult.artifact.pullRequestId, "pr-202");

const replay = await fetch(`${endpoint}/api/webhooks/github`, {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    "X-GitHub-Event": "pull_request",
    "X-GitHub-Delivery": deliveryId,
    "X-Hub-Signature-256": signature,
  },
  body,
});
assert.equal(replay.status, 200);
assert.equal((await replay.json()).duplicate, true);

const collectorOutput = execFileSync(process.execPath, [
  "bin/temporal.mjs",
  "collect",
  "claude",
  "--file",
  sessionPath.pathname,
  "--repo",
  "acme/platform-api",
  "--branch",
  "feature/export",
  "--actor",
  "aria",
  "--session",
  "e2e-claude-202",
  "--endpoint",
  endpoint,
], {
  cwd: new URL("..", import.meta.url),
  env: { ...process.env, TEMPORAL_ENDPOINT: endpoint, TEMPORAL_COLLECTOR_TOKEN: collectorToken },
  encoding: "utf8",
});
assert.match(collectorOutput, /linked 1 pull request/);

const artifactResponse = await fetch(`${endpoint}/api/artifacts/pr-202`);
assert.equal(artifactResponse.status, 200);
const artifact = await artifactResponse.json();
assert.equal(artifact.status, "ready");
assert.ok(artifact.events.some((event) => event.src === "claude"));
assert.ok(artifact.version >= 2);

const deliveryResponse = await fetch(`${endpoint}/api/pull-requests/pr-202/delivery`);
assert.equal(deliveryResponse.status, 200);
const delivery = await deliveryResponse.json();
assert.equal(delivery.head_sha, "e2eabc123");
assert.match(delivery.details_url, /artifact=pr-202/);

const dashboardResponse = await fetch(`${endpoint}/api/dashboard`);
assert.equal(dashboardResponse.status, 200);
const dashboard = await dashboardResponse.json();
assert.ok(dashboard.pullRequests.some((pr) => pr.id === "pr-202" && pr.status === "ready"));

console.log(`E2E complete: PR #202 → ${artifact.events.length} events → artifact v${artifact.version} → GitHub Check payload ready`);
