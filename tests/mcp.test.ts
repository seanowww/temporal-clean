import test from "node:test";
import assert from "node:assert/strict";
import { assessMcpProfile } from "../lib/mcp/profiles";
import { validateMcpServerUrl } from "../lib/mcp/client";
import { decryptOAuthVault, encryptOAuthVault } from "../lib/mcp/oauth";
import { mcpResultPayload } from "../lib/mcp/sync";

test("MCP server URLs require safe remote HTTPS endpoints", () => {
  assert.equal(validateMcpServerUrl("https://mcp.notion.com/mcp").toString(), "https://mcp.notion.com/mcp");
  assert.throws(() => validateMcpServerUrl("http://example.com/mcp"), /HTTPS/);
  assert.throws(() => validateMcpServerUrl("https://user:secret@example.com/mcp"), /credentials/);
  assert.throws(() => validateMcpServerUrl("https://192.168.1.10/mcp"), /Private-network/);
  assert.equal(validateMcpServerUrl("http://localhost:3333/mcp", "development").hostname, "localhost");
});

test("Notion MCP profile reports capability compatibility", () => {
  const base = { resources: [], resourceTemplates: [], discoveredAt: "2026-08-23T00:00:00.000Z" };
  const compatible = assessMcpProfile("notion", { ...base, tools: [{ name: "notion-search" }, { name: "notion-fetch" }] });
  assert.equal(compatible.compatible, true);
  const incomplete = assessMcpProfile("notion", { ...base, tools: [{ name: "notion-search" }] });
  assert.equal(incomplete.compatible, false);
  assert.deepEqual(incomplete.missing, ["notion-fetch or fetch"]);
});

test("MCP OAuth credentials are encrypted and authenticated at rest", () => {
  process.env.TEMPORAL_CREDENTIAL_KEY = "test-only-credential-key";
  const vault = encryptOAuthVault({ tokens: { access_token: "notion-secret", token_type: "Bearer", refresh_token: "refresh-secret" }, codeVerifier: "pkce-verifier" });
  assert.doesNotMatch(vault, /notion-secret|refresh-secret|pkce-verifier/);
  assert.equal(decryptOAuthVault(vault).tokens?.access_token, "notion-secret");
  const tampered = `${vault.slice(0, -1)}${vault.endsWith("A") ? "B" : "A"}`;
  assert.throws(() => decryptOAuthVault(tampered));
  delete process.env.TEMPORAL_CREDENTIAL_KEY;
});

test("MCP tool results prefer structured content and decode JSON text", () => {
  assert.deepEqual(mcpResultPayload({ structuredContent: { results: [{ id: "page-1" }] }, content: [] }), { results: [{ id: "page-1" }] });
  assert.deepEqual(mcpResultPayload({ content: [{ type: "text", text: "{\"results\":[{\"id\":\"page-2\"}]}" }] }), { results: [{ id: "page-2" }] });
});
