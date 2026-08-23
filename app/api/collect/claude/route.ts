import { NextResponse } from "next/server";
import { assembleArtifact } from "@/lib/artifact";
import { ingestClaudeSession, type ClaudeSessionInput } from "@/lib/ingest/claude";
import { verifyBearerToken } from "@/lib/security";

export const runtime = "nodejs";

export async function POST(request: Request) {
  if (!verifyBearerToken(request.headers.get("authorization"), process.env.TEMPORAL_COLLECTOR_TOKEN)) {
    return NextResponse.json({ error: "Invalid collector token" }, { status: 401 });
  }
  let payload: ClaudeSessionInput;
  try { payload = await request.json() as ClaudeSessionInput; }
  catch { return NextResponse.json({ error: "Invalid JSON payload" }, { status: 400 }); }

  try {
    const ingested = ingestClaudeSession(payload);
    const artifacts = [];
    for (const pullRequestId of ingested.linkedPullRequests) {
      artifacts.push(await assembleArtifact(pullRequestId, { useAi: false }));
    }
    return NextResponse.json({ accepted: true, ...ingested, artifacts }, { status: 202 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 422 });
  }
}
