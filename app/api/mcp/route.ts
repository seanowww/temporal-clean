import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import * as z from "zod/v4";
import { ingestClaudeSession } from "@/lib/ingest/claude";
import { assembleArtifact } from "@/lib/artifact";
import { getLatestArtifact, getPullRequest } from "@/lib/store";
import { verifyBearerToken } from "@/lib/security";

export const runtime = "nodejs";

function temporalServer() {
  const server = new McpServer({ name: "temporal", version: "0.1.0" });
  server.registerTool("temporal_record_session", {
    title: "Record Claude Code session",
    description: "Store a consequential Claude Code session in Temporal and link it to matching pull requests.",
    inputSchema: {
      sessionId: z.string().min(1), repository: z.string().min(1), branch: z.string().min(1), actor: z.string().min(1),
      startedAt: z.string().min(1), endedAt: z.string().optional(), commitShas: z.array(z.string()).optional(),
      messages: z.array(z.object({ id: z.string().optional(), role: z.enum(["user", "assistant", "tool"]), content: z.string(), timestamp: z.string().optional() })).min(1),
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
  }, async (input) => {
    const result = ingestClaudeSession(input);
    const artifacts = [];
    for (const pullRequestId of result.linkedPullRequests) artifacts.push(await assembleArtifact(pullRequestId, { useAi: false }));
    const output = { ...result, artifacts: artifacts.map((artifact) => ({ id: artifact.id, version: artifact.version, status: artifact.status })) };
    return { content: [{ type: "text", text: JSON.stringify(output) }], structuredContent: output };
  });
  server.registerTool("temporal_get_pr_context", {
    title: "Get pull request context",
    description: "Return Temporal's latest evidence-backed artifact for a pull request.",
    inputSchema: { pullRequestId: z.string().min(1) },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
  }, async ({ pullRequestId }) => {
    const pr = getPullRequest(pullRequestId);
    const artifact = getLatestArtifact(pullRequestId);
    if (!pr) return { isError: true, content: [{ type: "text", text: `Unknown pull request ${pullRequestId}` }] };
    const result = { pullRequest: pr, artifact };
    return { content: [{ type: "text", text: JSON.stringify(result) }], structuredContent: result };
  });
  return server;
}

async function handle(request: Request) {
  if (!verifyBearerToken(request.headers.get("authorization"), process.env.TEMPORAL_COLLECTOR_TOKEN)) {
    return Response.json({ error: "Invalid collector token" }, { status: 401 });
  }
  const server = temporalServer();
  const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  await server.connect(transport);
  try { return await transport.handleRequest(request); }
  finally { await server.close().catch(() => undefined); }
}

export const POST = handle;
export const GET = handle;
export const DELETE = handle;
