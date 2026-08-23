import { NextResponse } from "next/server";
import { assembleArtifact } from "@/lib/artifact";
import { getConnector } from "@/lib/connectors/catalog";
import { syncConnector, type SyncOptions } from "@/lib/connectors/sync";
import { getConnection } from "@/lib/store";
import { syncMcpConnection } from "@/lib/mcp/sync";

export const runtime = "nodejs";

/**
 * Newly linked evidence is invisible until the artifact is rebuilt: the previous version was
 * assembled when the PR arrived, before this sync existed. `/api/collect/claude` already
 * rebuilds on ingest, and the deterministic path is used deliberately — a sync must not
 * depend on the artifact agent being configured.
 */
async function refreshArtifacts(pullRequestIds: unknown) {
  if (!Array.isArray(pullRequestIds)) return [];
  const refreshed: string[] = [];
  for (const id of pullRequestIds) {
    if (typeof id !== "string") continue;
    try {
      const artifact = await assembleArtifact(id, { useAi: false });
      refreshed.push(`${id}@v${artifact.version}`);
    } catch {
      // A PR that cannot be rebuilt must not fail the sync that produced its evidence.
    }
  }
  return refreshed;
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const connector = getConnector(id);
  const connection = getConnection(id);
  if (!connector && !connection) return NextResponse.json({ error: "Unsupported connector" }, { status: 404 });

  // One read serves both callers: an MCP sync takes an `arguments` override, a local memory
  // sync takes a scope. An empty body is the common case from the Connections page.
  let body: Record<string, unknown> = {};
  try {
    const text = await request.text();
    if (text) body = JSON.parse(text) as Record<string, unknown>;
  } catch {
    // An absent or unparseable body falls back to no options.
  }

  try {
    let result: Record<string, unknown>;
    if (connection?.transport === "mcp-http") {
      const override = body.arguments;
      const argumentsOverride = override && typeof override === "object" && !Array.isArray(override)
        ? override as Record<string, unknown>
        : {};
      result = await syncMcpConnection(id, argumentsOverride) as unknown as Record<string, unknown>;
    } else {
      result = await syncConnector(connector!.id, body as SyncOptions) as unknown as Record<string, unknown>;
    }
    // MCP syncs already rebuild their own artifacts; rebuilding again would bump the
    // version a second time for the same evidence.
    const artifacts = result.artifacts ?? await refreshArtifacts(result.linkedPullRequests ?? result.linkedPullRequestIds);
    return NextResponse.json({ ok: true, ...result, artifacts });
  }
  catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 422 }); }
}
