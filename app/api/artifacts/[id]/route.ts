import { NextResponse } from "next/server";
import { ensureDemoSeed } from "@/lib/seed";
import { getLatestArtifact } from "@/lib/store";

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  await ensureDemoSeed();
  const artifact = getLatestArtifact(id);
  if (!artifact) {
    return NextResponse.json(
      { error: "Artifact is not ready", artifactId: id },
      { status: 404 },
    );
  }
  return NextResponse.json(artifact, {
    headers: { "Cache-Control": "no-store" },
  });
}
