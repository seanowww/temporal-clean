import { NextResponse } from "next/server";
import { discoverMcpServer } from "@/lib/mcp/client";
import { assessMcpProfile } from "@/lib/mcp/profiles";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const body = await request.json() as { serverUrl?: string; profile?: string; bearerToken?: string };
    if (!body.serverUrl) return NextResponse.json({ error: "MCP server URL is required." }, { status: 400 });
    const capabilities = await discoverMcpServer({
      serverUrl: body.serverUrl,
      headers: body.bearerToken ? { Authorization: `Bearer ${body.bearerToken}` } : undefined,
    });
    return NextResponse.json({ ok: true, capabilities, assessment: assessMcpProfile(body.profile || "generic", capabilities) });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const authorizationRequired = /unauthorized|401|authorization/i.test(message);
    return NextResponse.json({ error: authorizationRequired ? "This MCP server requires authorization." : message, authorizationRequired }, { status: authorizationRequired ? 401 : 422 });
  }
}
