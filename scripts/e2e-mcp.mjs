import assert from "node:assert/strict";
import { createHmac, randomUUID } from "node:crypto";
import { mkdtemp, readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { execFileSync, spawn } from "node:child_process";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";

const appPort = 3210;
const mcpPort = 3211;
const appEndpoint = `http://127.0.0.1:${appPort}`;
const mockEndpoint = `http://localhost:${mcpPort}/mcp`;
const webhookSecret = "mcp-e2e-secret";
const collectorToken = "mcp-e2e-collector";

function mockMcpServer() {
  const server = new McpServer({ name: "temporal-e2e-slack", version: "1.0.0" });
  server.registerTool("slack_search", { description: "Search approved Slack messages" }, async () => ({
    content: [{ type: "text", text: JSON.stringify({ channels: [{ id: "C-E2E", name: "exports", messages: [{ ts: "1787256000.000100", user: "U-QA", text: "EXP-77 retries must preserve job-level idempotency across worker restarts." }] }] }) }],
  }));
  return server;
}

const mockHttp = createServer(async (request, response) => {
  if (request.url !== "/mcp") { response.writeHead(404).end(); return; }
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString("utf8");
  const body = raw ? JSON.parse(raw) : undefined;
  const server = mockMcpServer();
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  await server.connect(transport);
  await transport.handleRequest(request, response, body);
  response.on("close", () => server.close().catch(() => undefined));
});

async function waitForApp() {
  for (let attempt = 0; attempt < 80; attempt++) {
    try { if ((await fetch(`${appEndpoint}/api/dashboard`)).ok) return; } catch {}
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error("Temporal did not start in time.");
}

const temp = await mkdtemp(path.join(tmpdir(), "temporal-mcp-e2e-"));
await new Promise((resolve) => mockHttp.listen(mcpPort, "127.0.0.1", resolve));
execFileSync("npm", ["run", "build"], { cwd: new URL("..", import.meta.url), stdio: "inherit" });
const next = spawn(process.execPath, ["node_modules/next/dist/bin/next", "start", "--hostname", "127.0.0.1", "--port", String(appPort)], {
  cwd: new URL("..", import.meta.url),
  env: { ...process.env, NODE_ENV: "production", TEMPORAL_ALLOW_PRIVATE_MCP: "true", TEMPORAL_DB_PATH: path.join(temp, "temporal.db"), GITHUB_WEBHOOK_SECRET: webhookSecret, TEMPORAL_COLLECTOR_TOKEN: collectorToken, TEMPORAL_APP_URL: appEndpoint },
  stdio: ["ignore", "pipe", "pipe"],
});
let serverOutput = "";
next.stdout.on("data", (chunk) => { serverOutput += chunk; });
next.stderr.on("data", (chunk) => { serverOutput += chunk; });

try {
  await waitForApp();
  const fixture = await readFile(new URL("../tests/fixtures/github-pr-opened.json", import.meta.url), "utf8");
  const signature = `sha256=${createHmac("sha256", webhookSecret).update(fixture).digest("hex")}`;
  const webhook = await fetch(`${appEndpoint}/api/webhooks/github`, { method: "POST", headers: { "Content-Type": "application/json", "X-GitHub-Event": "pull_request", "X-GitHub-Delivery": randomUUID(), "X-Hub-Signature-256": signature }, body: fixture });
  assert.equal(webhook.status, 202, await webhook.text());

  const connected = await fetch(`${appEndpoint}/api/connections/mcp`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: "Slack E2E", serverUrl: mockEndpoint, profile: "slack", source: "slack", toolName: "slack_search" }) });
  const connection = await connected.json();
  assert.equal(connected.status, 200, JSON.stringify(connection));

  const sync = await fetch(`${appEndpoint}/api/connections/${connection.id}/sync`, { method: "POST" });
  const synced = await sync.json();
  assert.equal(sync.status, 200, JSON.stringify(synced));
  assert.equal(synced.records, 1);
  assert.deepEqual(synced.linkedPullRequestIds, ["pr-202"]);

  const claude = new Client({ name: "claude-code-e2e", version: "1.0.0" }, { capabilities: {} });
  const temporalTransport = new StreamableHTTPClientTransport(new URL(`${appEndpoint}/api/mcp`), { requestInit: { headers: { Authorization: `Bearer ${collectorToken}` } } });
  await claude.connect(temporalTransport);
  await claude.callTool({ name: "temporal_record_session", arguments: { sessionId: "mcp-claude-e2e", repository: "acme/platform-api", branch: "feature/export", actor: "aria", startedAt: "2026-08-21T18:00:00.000Z", commitShas: ["e2eabc123"], messages: [{ role: "user", content: "Implement EXP-77 without duplicate retries." }, { role: "assistant", content: "Use job-level idempotency and preserve the key across restarts." }] } });
  await claude.close();

  const artifactResponse = await fetch(`${appEndpoint}/api/artifacts/pr-202`);
  const artifact = await artifactResponse.json();
  assert.equal(artifactResponse.status, 200, JSON.stringify(artifact));
  assert.ok(artifact.events.some((event) => event.src === "slack"));
  assert.ok(artifact.events.some((event) => event.src === "claude"));
  console.log(`MCP E2E complete: Slack tool → ${synced.records} record → Claude MCP session → artifact v${artifact.version}`);
} catch (error) {
  if (serverOutput) console.error(serverOutput);
  throw error;
} finally {
  next.kill("SIGTERM");
  await new Promise((resolve) => mockHttp.close(resolve));
}
