import type { ConnectorId } from "../connectors/catalog";
import { ingestConnectorDump } from "../connectors/ingest";
import { assembleArtifact } from "../artifact";
import { completeSyncRun, getConnection, startSyncRun, upsertConnection } from "../store";
import { callMcpTool } from "./client";
import { selectMcpReadTool } from "./profiles";
import { TemporalMcpOAuthProvider } from "./oauth";

const supportedSources = new Set<ConnectorId>(["github", "slack", "jira", "notion", "claude", "codex"]);

export function mcpResultPayload(value: unknown) {
  const result = value && typeof value === "object" ? value as Record<string, unknown> : {};
  if (result.structuredContent) return result.structuredContent;
  const content = Array.isArray(result.content) ? result.content : [];
  const text = content
    .filter((item): item is { type: "text"; text: string } => Boolean(item && typeof item === "object" && (item as Record<string, unknown>).type === "text" && typeof (item as Record<string, unknown>).text === "string"))
    .map((item) => item.text)
    .join("\n")
    .trim();
  if (!text) return [];
  try { return JSON.parse(text) as unknown; }
  catch { return { results: [{ id: `mcp-${Date.now()}`, title: "MCP result", content: text }] }; }
}

function mcpErrorMessage(value: unknown, tool: string) {
  const result = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const content = Array.isArray(result.content) ? result.content : [];
  const detail = content
    .filter((item): item is { type: "text"; text: string } => Boolean(item && typeof item === "object" && (item as Record<string, unknown>).type === "text" && typeof (item as Record<string, unknown>).text === "string"))
    .map((item) => item.text.trim())
    .filter(Boolean)
    .join(" ");
  return detail ? `${tool}: ${detail.slice(0, 500)}` : `MCP tool ${tool} returned an error.`;
}

function notionPageIds(value: unknown) {
  const ids = new Set<string>();
  const visit = (item: unknown) => {
    if (Array.isArray(item)) { item.forEach(visit); return; }
    if (!item || typeof item !== "object") return;
    const object = item as Record<string, unknown>;
    const id = typeof object.id === "string" ? object.id : typeof object.page_id === "string" ? object.page_id : null;
    if (id) ids.add(id);
    Object.values(object).forEach(visit);
  };
  visit(value);
  return [...ids].slice(0, 20);
}

function envHeaders(configuration: Record<string, unknown>) {
  const envName = typeof configuration.credentialEnv === "string" ? configuration.credentialEnv : "";
  if (!envName) return undefined;
  if (!/^[A-Z][A-Z0-9_]*$/.test(envName)) throw new Error("Invalid credential environment variable name.");
  const value = process.env[envName];
  if (!value) throw new Error(`Set ${envName} before syncing this MCP connection.`);
  return { Authorization: `Bearer ${value}` };
}

export async function syncMcpConnection(connectionId: string, overrideArguments: Record<string, unknown> = {}) {
  const connection = getConnection(connectionId);
  if (!connection || connection.transport !== "mcp-http" || !connection.serverUrl) throw new Error("Unknown MCP connection.");
  const source = connection.source as ConnectorId;
  if (!supportedSources.has(source)) throw new Error("Choose a supported Temporal source profile before syncing this MCP server.");
  const configuration = connection.configuration || {};
  const profile = typeof configuration.profile === "string" ? configuration.profile : source;
  const tool = selectMcpReadTool(profile, connection.capabilities || { tools: [], resources: [], resourceTemplates: [], discoveredAt: "" }, typeof configuration.toolName === "string" ? configuration.toolName : undefined);
  if (!tool) throw new Error("This MCP server does not advertise a readable tool.");
  const savedArguments = configuration.arguments && typeof configuration.arguments === "object" ? configuration.arguments as Record<string, unknown> : {};
  const args = { ...savedArguments, ...overrideArguments };
  const syncRunId = startSyncRun(connection.id, { transport: "mcp-http", tool });
  try {
    const authProvider = connection.authType === "oauth" ? new TemporalMcpOAuthProvider(connection.id) : undefined;
    const result = await callMcpTool({ serverUrl: connection.serverUrl, headers: envHeaders(configuration), authProvider, tool, arguments: args });
    if ("isError" in result && result.isError) throw new Error(mcpErrorMessage(result, tool));
    let payload = mcpResultPayload(result);
    if (source === "notion") {
      const available = new Set(connection.capabilities?.tools.map((entry) => entry.name) || []);
      const fetchTool = ["notion-fetch", "fetch"].find((name) => available.has(name));
      const pageIds = notionPageIds(payload);
      if (fetchTool && pageIds.length) {
        const pages = [];
        for (const id of pageIds) {
          const fetched = await callMcpTool({ serverUrl: connection.serverUrl, authProvider, tool: fetchTool, arguments: { id } });
          if (!("isError" in fetched && fetched.isError)) pages.push(mcpResultPayload(fetched));
        }
        if (pages.length) payload = { results: pages.flatMap((page) => Array.isArray(page) ? page : [page]) };
      }
    }
    const imported = ingestConnectorDump(source, JSON.stringify(payload), {
      connectionId: connection.id,
      syncRunId,
      filename: `${connection.id}-${tool}.json`,
      importedAt: new Date().toISOString(),
      repository: typeof configuration.repository === "string" ? configuration.repository : undefined,
      branch: typeof configuration.branch === "string" ? configuration.branch : undefined,
    });
    completeSyncRun(syncRunId, { recordsSeen: imported.records, recordsWritten: imported.records });
    upsertConnection({ ...connection, status: "connected", lastSync: new Date().toISOString(), scope: `${imported.records} records via ${tool}` });
    const artifacts = [];
    for (const pullRequestId of imported.linkedPullRequestIds) artifacts.push(await assembleArtifact(pullRequestId, { useAi: false }));
    return { ...imported, tool, syncRunId, artifacts };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    completeSyncRun(syncRunId, { error: message });
    upsertConnection({ ...connection, status: "needs_attention", metadata: { ...connection.metadata, lastError: message } });
    throw error;
  }
}
