import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { discoverMcpServer, validateMcpServerUrl } from "@/lib/mcp/client";
import { assessMcpProfile } from "@/lib/mcp/profiles";
import { upsertConnection } from "@/lib/store";
import { beginMcpOAuth } from "@/lib/mcp/oauth";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const body = await request.json() as { name?: string; serverUrl?: string; profile?: string; bearerToken?: string; source?: string; toolName?: string; arguments?: Record<string, unknown>; credentialEnv?: string; repository?: string; branch?: string };
    if (!body.name?.trim() || !body.serverUrl) return NextResponse.json({ error: "Name and MCP server URL are required." }, { status: 400 });
    const serverUrl = validateMcpServerUrl(body.serverUrl).toString();
    const profileId = body.profile || "generic";
    const profileAssessment = assessMcpProfile(profileId, { tools: [], resources: [], resourceTemplates: [], discoveredAt: new Date().toISOString() });
    const id = `mcp-${randomUUID()}`;
    const configuration = { profile: profileId, toolName: body.toolName, arguments: body.arguments || {}, credentialEnv: body.credentialEnv, repository: body.repository, branch: body.branch };
    if (profileId === "notion" && !body.bearerToken) {
      upsertConnection({
        id, source: body.source || profileAssessment.profile.source, name: body.name.trim(), description: "Awaiting OAuth authorization",
        status: "authorizing", scope: new URL(serverUrl).hostname, transport: "mcp-http", serverUrl, authType: "oauth", configuration,
      });
      const authorizationUrl = await beginMcpOAuth(id);
      return NextResponse.json({ ok: true, id, authorizationRequired: true, authorizationUrl }, { status: 202 });
    }
    const headers = body.bearerToken ? { Authorization: `Bearer ${body.bearerToken}` } : undefined;
    const capabilities = await discoverMcpServer({ serverUrl, headers });
    const assessment = assessMcpProfile(profileId, capabilities);
    upsertConnection({
      id,
      source: body.source || assessment.profile.source,
      name: body.name.trim(),
      description: `${capabilities.tools.length} tools · ${capabilities.resources.length} resources`,
      status: assessment.compatible ? "connected" : "needs_attention",
      scope: new URL(serverUrl).hostname,
      transport: "mcp-http",
      serverUrl,
      authType: body.bearerToken ? "bearer" : "none",
      capabilities,
      configuration,
      // Credentials deliberately are not persisted until encrypted credential storage lands.
      metadata: { compatibilityWarnings: assessment.missing },
    });
    return NextResponse.json({ ok: true, id, capabilities, assessment });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 422 });
  }
}
