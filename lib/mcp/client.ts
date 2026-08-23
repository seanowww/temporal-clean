import { isIP } from "node:net";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { OAuthClientProvider } from "@modelcontextprotocol/sdk/client/auth.js";
import type { McpCapabilitySnapshot } from "../types";

const PRIVATE_IPV4 = /^(?:10\.|127\.|169\.254\.|192\.168\.|172\.(?:1[6-9]|2\d|3[01])\.)/;

export function validateMcpServerUrl(value: string, environment = process.env.NODE_ENV) {
  let url: URL;
  try { url = new URL(value); }
  catch { throw new Error("Enter a valid MCP server URL."); }
  if (url.username || url.password) throw new Error("MCP server URLs cannot contain credentials.");
  const local = url.hostname === "localhost" || url.hostname === "[::1]" || url.hostname === "::1";
  const privateMcpAllowed = process.env.TEMPORAL_ALLOW_PRIVATE_MCP === "true";
  if (url.protocol !== "https:" && !((environment !== "production" || privateMcpAllowed) && local)) {
    throw new Error("Remote MCP servers must use HTTPS.");
  }
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (!local && ((isIP(host) === 4 && PRIVATE_IPV4.test(host)) || (isIP(host) === 6 && /^(?:fc|fd|fe80)/i.test(host)))) {
    throw new Error("Private-network MCP servers are not enabled.");
  }
  url.hash = "";
  return url;
}

function requestHeaders(headers?: Record<string, string>) {
  if (!headers) return undefined;
  const allowed = Object.entries(headers).filter(([name]) => ["authorization", "x-api-key"].includes(name.toLowerCase()));
  return Object.fromEntries(allowed);
}

export async function withMcpClient<T>(options: { serverUrl: string; headers?: Record<string, string>; timeoutMs?: number; authProvider?: OAuthClientProvider }, operation: (client: Client) => Promise<T>) {
  const url = validateMcpServerUrl(options.serverUrl);
  const client = new Client({ name: "temporal", version: "0.1.0" }, { capabilities: {} });
  const transport = new StreamableHTTPClientTransport(url, { authProvider: options.authProvider, requestInit: { headers: requestHeaders(options.headers) } });
  const timeoutMs = Math.min(Math.max(options.timeoutMs || 15_000, 1_000), 30_000);
  const timeout = AbortSignal.timeout(timeoutMs);
  try {
    await client.connect(transport, { signal: timeout });
    return await operation(client);
  } finally {
    await client.close().catch(() => undefined);
  }
}

export async function discoverMcpServer(options: { serverUrl: string; headers?: Record<string, string>; authProvider?: OAuthClientProvider }): Promise<McpCapabilitySnapshot> {
  return withMcpClient(options, async (client) => {
    const capabilities = client.getServerCapabilities();
    const [toolResult, resourceResult, templateResult] = await Promise.all([
      capabilities?.tools ? client.listTools() : Promise.resolve({ tools: [] }),
      capabilities?.resources ? client.listResources() : Promise.resolve({ resources: [] }),
      capabilities?.resources ? client.listResourceTemplates() : Promise.resolve({ resourceTemplates: [] }),
    ]);
    const server = client.getServerVersion();
    return {
      server: server ? { name: server.name, version: server.version } : undefined,
      tools: toolResult.tools.map((tool) => ({ name: tool.name, description: tool.description, inputSchema: tool.inputSchema as Record<string, unknown> })),
      resources: resourceResult.resources.map((resource) => ({ uri: resource.uri, name: resource.name, description: resource.description, mimeType: resource.mimeType })),
      resourceTemplates: templateResult.resourceTemplates.map((resource) => ({ uriTemplate: resource.uriTemplate, name: resource.name, description: resource.description, mimeType: resource.mimeType })),
      discoveredAt: new Date().toISOString(),
    };
  });
}

export async function callMcpTool(options: { serverUrl: string; headers?: Record<string, string>; tool: string; arguments?: Record<string, unknown>; authProvider?: OAuthClientProvider }) {
  return withMcpClient(options, (client) => client.callTool({ name: options.tool, arguments: options.arguments || {} }));
}
