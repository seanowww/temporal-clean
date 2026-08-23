import type { ArtifactPayload } from "./types";
import type { StoredPullRequest } from "./store";
import { getGitHubAccessToken, getGitHubAppConfig, githubApiHeaders, githubAuthMode } from "./github-app";

const COMMENT_MARKER = "<!-- temporal-artifact -->";

const jsonHeaders = (token: string) => ({ ...githubApiHeaders(token), "Content-Type": "application/json" });

export function artifactUrl(pullRequestId: string) {
  const staticBaseUrl = process.env.TEMPORAL_STATIC_ARTIFACT_BASE_URL?.replace(/\/$/, "");
  if (staticBaseUrl) return `${staticBaseUrl}/${encodeURIComponent(pullRequestId)}.html`;
  const baseUrl = (process.env.TEMPORAL_APP_URL || "http://localhost:3000").replace(/\/$/, "");
  return `${baseUrl}/artifact/index.html?artifact=${encodeURIComponent(pullRequestId)}`;
}

export function buildGitHubCheckPayload(pr: StoredPullRequest, artifact: ArtifactPayload) {
  const detailsUrl = artifactUrl(pr.id);
  return {
    name: "Temporal timeline",
    head_sha: pr.headSha,
    status: "completed",
    conclusion: artifact.status === "ready" ? "success" : "neutral",
    details_url: detailsUrl,
    output: {
      title: "Timeline ready",
      summary: primaryContext(artifact),
      text: `[View timeline →](${detailsUrl})`,
    },
  };
}

export async function deliverGitHubCheck(pr: StoredPullRequest, artifact: ArtifactPayload, authToken?: string | null) {
  const payload = buildGitHubCheckPayload(pr, artifact);
  const token = authToken === undefined ? await getGitHubAccessToken() : authToken;
  if (!token || !pr.headSha) return { delivered: false as const, reason: !pr.headSha ? "missing_head_sha" : "missing_github_auth", payload };
  const response = await fetch(`https://api.github.com/repos/${pr.repository}/check-runs`, {
    method: "POST",
    headers: jsonHeaders(token),
    body: JSON.stringify(payload),
  });
  if (!response.ok) throw new Error(`GitHub Check delivery failed: ${response.status} ${await response.text()}`);
  return { delivered: true as const, payload, response: await response.json() };
}

function concise(value: string, max = 180) {
  const clean = value.replace(/\s+/g, " ").trim();
  return clean.length <= max ? clean : `${clean.slice(0, max - 1).trimEnd()}…`;
}

function primaryContext(artifact: ArtifactPayload) {
  const summaryLead = artifact.summary?.split(/\s+·\s+/)[0];
  if (summaryLead) return concise(summaryLead);
  const evidence = artifact.events
    .filter((event) => Number(event.t) > .06)
    .sort((a, b) => Number(b.imp || 0) - Number(a.imp || 0))[0];
  return concise(evidence?.title || "Review the context behind this change.");
}

export function buildGitHubCommentBody(pr: StoredPullRequest, artifact: ArtifactPayload) {
  const detailsUrl = artifactUrl(pr.id);
  return [
    COMMENT_MARKER,
    "## Temporal timeline ready",
    "",
    primaryContext(artifact),
    "",
    `**[View timeline →](${detailsUrl})**`,
    "",
    `<sub>Updated for \`${pr.headSha?.slice(0, 7) || pr.branch}\`</sub>`,
  ].join("\n");
}

export function buildGitHubDeploymentPayload(pr: StoredPullRequest) {
  return {
    ref: pr.headSha,
    task: "temporal",
    auto_merge: false,
    required_contexts: [],
    environment: `Temporal / PR #${pr.number}`,
    description: "Preview the context behind this pull request",
    transient_environment: true,
    production_environment: false,
    payload: { provider: "temporal", pull_request: pr.number },
  };
}

export function buildGitHubDeploymentStatusPayload(pr: StoredPullRequest) {
  const url = artifactUrl(pr.id);
  return {
    state: "success",
    environment: `Temporal / PR #${pr.number}`,
    environment_url: url,
    log_url: url,
    description: "Timeline ready",
  };
}

type GitHubDeployment = { id: number; task?: string; environment?: string };

export async function deliverGitHubDeployment(pr: StoredPullRequest, authToken?: string | null) {
  const payload = buildGitHubDeploymentPayload(pr);
  const status = buildGitHubDeploymentStatusPayload(pr);
  const token = authToken === undefined ? await getGitHubAccessToken() : authToken;
  if (!token || !pr.headSha) return { delivered: false as const, reason: !pr.headSha ? "missing_head_sha" : "missing_github_auth", payload, status };

  const query = new URLSearchParams({ sha: pr.headSha, environment: payload.environment, per_page: "100" });
  const existingResponse = await fetch(`https://api.github.com/repos/${pr.repository}/deployments?${query}`, { headers: githubApiHeaders(token) });
  if (!existingResponse.ok) throw new Error(`GitHub Deployment lookup failed: ${existingResponse.status} ${await existingResponse.text()}`);
  const existing = (await existingResponse.json() as GitHubDeployment[]).find((deployment) => deployment.task === payload.task && deployment.environment === payload.environment);

  let deployment = existing;
  if (!deployment) {
    const response = await fetch(`https://api.github.com/repos/${pr.repository}/deployments`, {
      method: "POST",
      headers: jsonHeaders(token),
      body: JSON.stringify(payload),
    });
    if (!response.ok) throw new Error(`GitHub Deployment delivery failed: ${response.status} ${await response.text()}`);
    deployment = await response.json() as GitHubDeployment;
  }

  const statusResponse = await fetch(`https://api.github.com/repos/${pr.repository}/deployments/${deployment.id}/statuses`, {
    method: "POST",
    headers: jsonHeaders(token),
    body: JSON.stringify(status),
  });
  if (!statusResponse.ok) throw new Error(`GitHub Deployment status failed: ${statusResponse.status} ${await statusResponse.text()}`);
  return { delivered: true as const, mode: existing ? "updated" as const : "created" as const, payload, status, deployment, response: await statusResponse.json() };
}

type IssueComment = { id?: number; body?: string; user?: { login?: string; type?: string }; performed_via_github_app?: { id?: number } | null };

/**
 * Find the comment this app previously posted. Matching on the marker alone lets any
 * comment containing that string capture the update, so when running as an App the
 * authoring app id is the real key and the marker is only a fallback.
 */
async function findExistingComment(repository: string, number: number, token: string) {
  const response = await fetch(`https://api.github.com/repos/${repository}/issues/${number}/comments?per_page=100`, { headers: githubApiHeaders(token) });
  if (!response.ok) throw new Error(`GitHub comment lookup failed: ${response.status} ${await response.text()}`);
  const comments = await response.json() as IssueComment[];
  const appId = Number(getGitHubAppConfig()?.appId);
  const marked = comments.filter((comment) => typeof comment.body === "string" && comment.body.includes(COMMENT_MARKER));
  if (Number.isFinite(appId)) {
    const ours = marked.find((comment) => comment.performed_via_github_app?.id === appId);
    if (ours) return ours;
  }
  return marked[0] || null;
}

/**
 * One Temporal comment per PR, found by its hidden marker and edited in place.
 * Every `pull_request` delivery used to POST a new comment, so a demo that reran the
 * webhook a few times buried the PR under duplicates.
 */
export async function deliverGitHubComment(pr: StoredPullRequest, artifact: ArtifactPayload, authToken?: string | null) {
  const body = buildGitHubCommentBody(pr, artifact);
  const token = authToken === undefined ? await getGitHubAccessToken() : authToken;
  if (!token) return { delivered: false as const, reason: "missing_github_auth", mode: "skipped" as const, body };

  const existing = await findExistingComment(pr.repository, pr.number, token);
  const url = existing?.id
    ? `https://api.github.com/repos/${pr.repository}/issues/comments/${existing.id}`
    : `https://api.github.com/repos/${pr.repository}/issues/${pr.number}/comments`;
  const response = await fetch(url, { method: existing?.id ? "PATCH" : "POST", headers: jsonHeaders(token), body: JSON.stringify({ body }) });
  if (!response.ok) throw new Error(`GitHub comment delivery failed: ${response.status} ${await response.text()}`);
  const result = await response.json() as IssueComment;
  return {
    delivered: true as const,
    mode: existing?.id ? "updated" as const : "created" as const,
    // Surface who GitHub actually attributed this to, so posting as a human is visible.
    authMode: githubAuthMode(),
    postedAs: result.user?.login,
    isBot: result.user?.type === "Bot",
    body,
    response: result,
  };
}
