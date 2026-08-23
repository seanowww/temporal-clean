import { timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { getGitHubInstallation, listInstallationRepositories } from "@/lib/github-app";
import { upsertConnection } from "@/lib/store";

export const runtime = "nodejs";

function matchesState(received: string | null, expected?: string) {
  if (!received || !expected || received.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(received), Buffer.from(expected));
}

function redirect(request: Request, status: string) {
  const base = process.env.TEMPORAL_APP_URL || new URL(request.url).origin;
  const url = new URL("/connections", base);
  url.searchParams.set("github", status);
  return NextResponse.redirect(url);
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const cookieStore = await cookies();
  const expectedState = cookieStore.get("temporal_github_state")?.value;
  cookieStore.delete("temporal_github_state");
  if (!matchesState(url.searchParams.get("state"), expectedState)) return redirect(request, "invalid_state");
  if (url.searchParams.get("setup_action") === "request") return redirect(request, "requested");

  const installationId = Number(url.searchParams.get("installation_id"));
  if (!Number.isSafeInteger(installationId) || installationId <= 0) return redirect(request, "missing_installation");
  try {
    const [installation, repositories] = await Promise.all([
      getGitHubInstallation(installationId),
      listInstallationRepositories(installationId),
    ]);
    upsertConnection({
      id: "github",
      name: "GitHub",
      description: "Pull requests, commits, changed files, reviews",
      status: "connected",
      scope: `${installation.account.login} · ${repositories.length} ${repositories.length === 1 ? "repository" : "repositories"}`,
      lastSync: new Date().toISOString(),
      metadata: {
        authType: "github_app",
        installationId,
        accountLogin: installation.account.login,
        accountType: installation.account.type,
        repositorySelection: installation.repository_selection,
        repositoryCount: repositories.length,
        repositories: repositories.map((repository) => repository.full_name),
        installationUrl: installation.html_url,
      },
    });
    return redirect(request, "connected");
  } catch {
    return redirect(request, "api_error");
  }
}
