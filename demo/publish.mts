import { assembleArtifact } from "../lib/artifact.ts";
import { deliverGitHubCheck, deliverGitHubComment, deliverGitHubDeployment } from "../lib/delivery.ts";
import { getGitHubAccessToken } from "../lib/github-app.ts";
import { getPullRequest } from "../lib/store.ts";

const pullRequestId = process.env.GOLDEN_PR_ID || "pr-2";
const pullRequest = getPullRequest(pullRequestId);
if (!pullRequest) throw new Error(`${pullRequestId} has not been ingested. Open or update the golden PR first.`);

const artifact = await assembleArtifact(pullRequestId, { useAi: false });
const token = await getGitHubAccessToken();
const [check, comment, deployment] = await Promise.allSettled([
  deliverGitHubCheck(pullRequest, artifact, token),
  deliverGitHubComment(pullRequest, artifact, token),
  deliverGitHubDeployment(pullRequest, token),
]);

const result = (settled: PromiseSettledResult<unknown>) => settled.status === "fulfilled"
  ? settled.value
  : { delivered: false, error: settled.reason instanceof Error ? settled.reason.message : String(settled.reason) };

console.log(JSON.stringify({
  pullRequest: `${pullRequest.repository}#${pullRequest.number}`,
  artifact: { version: artifact.version, events: artifact.events.length, sources: artifact.coverage.map((entry) => entry.source) },
  check: result(check),
  comment: result(comment),
  deployment: result(deployment),
}, null, 2));

if (deployment.status === "rejected") {
  throw new Error("GitHub Deployment was not published. Confirm Deployments: read and write is approved for the app installation.");
}
