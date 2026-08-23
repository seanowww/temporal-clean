import { NextResponse } from "next/server";
import { buildArtifactWithAgentFallback } from "@/lib/agent/pr-agent";
import { deliverGitHubCheck, deliverGitHubComment, deliverGitHubDeployment } from "@/lib/delivery";
import { getGitHubAccessToken, githubAuthMode, githubBotLogin } from "@/lib/github-app";
import { backfillPullRequestFromApi } from "@/lib/ingest/github-api";
import { ingestGitHubWebhook, type GitHubWebhookPayload } from "@/lib/ingest/github";
import { verifyGitHubSignature } from "@/lib/security";
import { getPullRequest } from "@/lib/store";

export const runtime = "nodejs";

/** Actions that change what Temporal could reconstruct. Everything else is ingested but not rebuilt. */
const REBUILD_ACTIONS = new Set(["opened", "reopened", "synchronize", "edited", "ready_for_review"]);

/** Delivery to GitHub is best effort: a failed comment must not lose an artifact Temporal already built. */
async function settle<T>(task: () => Promise<T>) {
  try { return await task(); }
  catch (error) { return { delivered: false as const, error: error instanceof Error ? error.message : String(error) }; }
}

export async function POST(request: Request) {
  const body = await request.text();
  const signature = request.headers.get("x-hub-signature-256");
  const secret = process.env.GITHUB_WEBHOOK_SECRET;
  const verified = verifyGitHubSignature(body, signature, secret);
  if (!verified && (process.env.NODE_ENV === "production" || secret)) {
    return NextResponse.json({ error: "Invalid GitHub signature" }, { status: 401 });
  }

  let payload: GitHubWebhookPayload;
  try { payload = JSON.parse(body) as GitHubWebhookPayload; }
  catch { return NextResponse.json({ error: "Invalid JSON payload" }, { status: 400 }); }

  const eventType = request.headers.get("x-github-event") || "unknown";
  const deliveryId = request.headers.get("x-github-delivery") || crypto.randomUUID();
  try {
    const ingested = ingestGitHubWebhook(deliveryId, eventType, payload);
    if (ingested.duplicate) return NextResponse.json({ accepted: true, duplicate: true });

    let artifact = null;
    let delivery = null;
    let agent = null;
    let backfill = null;
    let identity: { mode: string; postsAs: string | null } | null = null;
    let skipped: string | undefined;
    if (eventType === "pull_request") {
      const result = ingested.result as { pullRequestId?: string };
      const action = payload.action || "";
      if (result.pullRequestId && REBUILD_ACTIONS.has(action)) {
        const token = await getGitHubAccessToken();
        identity = { mode: githubAuthMode(), postsAs: githubBotLogin() };
        // Commits and diff size come from the API, not the webhook payload; a failure here
        // must not stop Temporal reconstructing whatever evidence it already holds.
        backfill = await settle(() => backfillPullRequestFromApi(result.pullRequestId!, token));
        const built = await buildArtifactWithAgentFallback(result.pullRequestId);
        artifact = built.artifact;
        agent = { used: built.agent, reason: "reason" in built ? built.reason : undefined };
        const pr = getPullRequest(result.pullRequestId);
        if (pr) delivery = {
          deployment: await settle(() => deliverGitHubDeployment(pr, token)),
          check: await settle(() => deliverGitHubCheck(pr, artifact!, token)),
          comment: await settle(() => deliverGitHubComment(pr, artifact!, token)),
        };
      } else if (result.pullRequestId) {
        skipped = `no rebuild for action "${action}"`;
      }
    }
    return NextResponse.json({ accepted: true, verified, identity, ingested: ingested.result, backfill, artifact, agent, delivery, skipped }, { status: 202 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 422 });
  }
}
