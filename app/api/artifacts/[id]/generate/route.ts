import { NextResponse } from "next/server";
import { assembleArtifact } from "@/lib/artifact";
import { deliverGitHubCheck } from "@/lib/delivery";
import { ensureDemoSeed } from "@/lib/seed";
import { getPullRequest } from "@/lib/store";

export const runtime = "nodejs";

export async function POST(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  await ensureDemoSeed();
  const pr = getPullRequest(id);
  if (!pr) return NextResponse.json({ error: "Unknown PR seed" }, { status: 404 });
  if (!process.env.OPENAI_API_KEY) {
    return NextResponse.json({ error: "Artifact agent is not configured" }, { status: 503 });
  }
  try {
    const artifact = await assembleArtifact(id, { useAi: true });
    const delivery = await deliverGitHubCheck(pr, artifact);
    return NextResponse.json({ artifact, delivery });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 422 });
  }
}
