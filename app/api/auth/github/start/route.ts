import { randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { getGitHubAppConfig, githubAppInstallationUrl } from "@/lib/github-app";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const config = getGitHubAppConfig();
  if (!config) return NextResponse.redirect(new URL("/connections?github=setup_required", request.url));
  const state = randomBytes(32).toString("base64url");
  const cookieStore = await cookies();
  cookieStore.set("temporal_github_state", state, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/api/auth/github/callback",
    maxAge: 10 * 60,
  });
  return NextResponse.redirect(githubAppInstallationUrl(config.slug, state));
}
