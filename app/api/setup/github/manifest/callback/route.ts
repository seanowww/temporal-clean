import { timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { saveLocalGitHubAppEnvironment, type GitHubManifestConversion } from "@/lib/github-app-manifest";

export const runtime = "nodejs";
function matches(received: string | null, expected?: string) { return Boolean(received && expected && received.length === expected.length && timingSafeEqual(Buffer.from(received!), Buffer.from(expected!))); }
function connections(request: Request, status: string) { const url = new URL("/connections", process.env.TEMPORAL_APP_URL || new URL(request.url).origin); url.searchParams.set("github", status); return NextResponse.redirect(url); }

export async function GET(request: Request) {
  const url = new URL(request.url);
  const cookieStore = await cookies();
  const expected = cookieStore.get("temporal_github_manifest_state")?.value;
  cookieStore.delete("temporal_github_manifest_state");
  if (!matches(url.searchParams.get("state"), expected)) return connections(request, "manifest_invalid_state");
  const code = url.searchParams.get("code");
  if (!code) return connections(request, "manifest_failed");
  try {
    const response = await fetch(`https://api.github.com/app-manifests/${encodeURIComponent(code)}/conversions`, { method: "POST", headers: { Accept: "application/vnd.github+json", "X-GitHub-Api-Version": process.env.GITHUB_API_VERSION || "2026-03-10" } });
    if (!response.ok) throw new Error(`Manifest conversion failed (${response.status})`);
    await saveLocalGitHubAppEnvironment(await response.json() as GitHubManifestConversion);
    return NextResponse.redirect(new URL("/api/auth/github/start", process.env.TEMPORAL_APP_URL || url.origin));
  } catch (error) {
    console.error("GitHub App manifest setup failed", error);
    return connections(request, process.env.NODE_ENV === "production" ? "manifest_local_only" : "manifest_failed");
  }
}
