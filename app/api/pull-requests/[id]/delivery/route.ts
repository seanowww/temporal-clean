import { NextResponse } from "next/server";
import { buildGitHubCheckPayload } from "@/lib/delivery";
import { getLatestArtifact, getPullRequest } from "@/lib/store";

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  const pr = getPullRequest(id);
  const artifact = getLatestArtifact(id);
  if (!pr || !artifact) return NextResponse.json({ error: "PR artifact not found" }, { status: 404 });
  return NextResponse.json(buildGitHubCheckPayload(pr, artifact));
}
