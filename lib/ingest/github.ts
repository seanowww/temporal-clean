import {
  completeWebhookDelivery,
  getGraphNodeBySource,
  listGraphNodes,
  listConnections,
  listPullRequests,
  recordWebhookDelivery,
  upsertConnection,
  upsertGraphEdge,
  upsertGraphNode,
  upsertPullRequest,
} from "../store";

type GitHubUser = { login?: string };
type GitHubRepository = { full_name?: string; html_url?: string };
type GitHubPullRequest = {
  number?: number;
  title?: string;
  body?: string | null;
  html_url?: string;
  state?: string;
  created_at?: string;
  updated_at?: string;
  changed_files?: number;
  additions?: number;
  deletions?: number;
  commits?: number;
  user?: GitHubUser;
  head?: { ref?: string; sha?: string };
  base?: { ref?: string };
};
type GitHubCommit = {
  id?: string;
  message?: string;
  timestamp?: string;
  url?: string;
  author?: { username?: string; name?: string };
};

export type GitHubWebhookPayload = {
  action?: string;
  repository?: GitHubRepository;
  pull_request?: GitHubPullRequest;
  number?: number;
  ref?: string;
  after?: string;
  commits?: GitHubCommit[];
  sender?: GitHubUser;
  installation?: { id?: number; account?: { login?: string; type?: string }; repository_selection?: "all" | "selected" };
  repositories?: Array<{ full_name?: string }>;
  repositories_added?: Array<{ full_name?: string }>;
  repositories_removed?: Array<{ full_name?: string }>;
};

const ticketPattern = /\b[A-Z][A-Z0-9]{1,9}-\d+\b/g;

function requireString(value: unknown, field: string) {
  if (typeof value !== "string" || !value.trim()) throw new Error(`Missing ${field}`);
  return value;
}

function linkNodeToMatchingPr(nodeId: string, repository: string, branch?: string, commitSha?: string) {
  for (const pr of listPullRequests()) {
    if (pr.repository !== repository) continue;
    const branchMatch = branch && pr.branch === branch;
    const commitMatch = commitSha && pr.headSha === commitSha;
    if (!branchMatch && !commitMatch) continue;
    const prNode = getGraphNodeBySource("github", `${repository}#${pr.number}`);
    if (!prNode) continue;
    upsertGraphEdge({
      fromNodeId: prNode.id,
      toNodeId: nodeId,
      type: commitMatch ? "CONTAINS" : "CONTEXT_FOR",
      confidence: commitMatch ? 1 : .9,
    });
  }
}

function ingestPullRequest(payload: GitHubWebhookPayload) {
  const repository = requireString(payload.repository?.full_name, "repository.full_name");
  const pullRequest = payload.pull_request;
  if (!pullRequest) throw new Error("Missing pull_request");
  const number = Number(pullRequest.number || payload.number);
  if (!Number.isInteger(number) || number <= 0) throw new Error("Missing pull request number");
  const title = requireString(pullRequest.title, "pull_request.title");
  const branch = requireString(pullRequest.head?.ref, "pull_request.head.ref");
  const baseBranch = requireString(pullRequest.base?.ref, "pull_request.base.ref");
  const author = pullRequest.user?.login || payload.sender?.login || "unknown";
  const openedAt = pullRequest.created_at || new Date().toISOString();
  const updatedAt = pullRequest.updated_at || openedAt;
  const body = pullRequest.body || "";
  const ticketIds = [...new Set(`${title}\n${body}`.match(ticketPattern) || [])];

  const pullRequestId = upsertPullRequest({
    repository,
    number,
    title,
    body,
    author,
    branch,
    baseBranch,
    headSha: pullRequest.head?.sha,
    status: pullRequest.state || "open",
    openedAt,
    updatedAt,
    artifactStatus: "building",
    metadata: { url: pullRequest.html_url, ticketIds, filesChanged: pullRequest.changed_files, additions: pullRequest.additions, deletions: pullRequest.deletions, commitCount: pullRequest.commits },
  });
  const prNodeId = upsertGraphNode({
    type: "pull_request",
    source: "github",
    sourceId: `${repository}#${number}`,
    title,
    content: body,
    occurredAt: openedAt,
    actorId: author,
    repository,
    branch,
    commitSha: pullRequest.head?.sha,
    sourceUrl: pullRequest.html_url,
    metadata: { pullRequestId, number, baseBranch, ticketIds, action: payload.action },
  });

  for (const node of listGraphNodes()) {
    if (node.id === prNodeId || node.repository !== repository) continue;
    if (node.branch === branch || (pullRequest.head?.sha && node.commitSha === pullRequest.head.sha)) {
      upsertGraphEdge({ fromNodeId: prNodeId, toNodeId: node.id, type: "CONTEXT_FOR", confidence: node.commitSha === pullRequest.head?.sha ? 1 : .9 });
    }
  }
  return { pullRequestId, nodeId: prNodeId };
}

function ingestPush(payload: GitHubWebhookPayload) {
  const repository = requireString(payload.repository?.full_name, "repository.full_name");
  const branch = requireString(payload.ref, "ref").replace(/^refs\/heads\//, "");
  const nodeIds: string[] = [];
  for (const commit of payload.commits || []) {
    const sha = requireString(commit.id, "commit.id");
    const nodeId = upsertGraphNode({
      type: "commit",
      source: "github",
      sourceId: `${repository}@${sha}`,
      title: (commit.message || "Commit").split("\n")[0],
      content: commit.message || "",
      occurredAt: commit.timestamp || new Date().toISOString(),
      actorId: commit.author?.username || commit.author?.name,
      repository,
      branch,
      commitSha: sha,
      sourceUrl: commit.url,
      metadata: { after: payload.after },
    });
    nodeIds.push(nodeId);
    linkNodeToMatchingPr(nodeId, repository, branch, sha);
  }
  return { repository, branch, nodeIds };
}

function ingestInstallation(payload: GitHubWebhookPayload, eventType: string) {
  const current = listConnections().find((connection) => connection.id === "github");
  const previous = current?.metadata || {};
  const action = payload.action || "updated";
  const accountLogin = payload.installation?.account?.login || String(previous.accountLogin || "GitHub account");
  const previousRepositories = Array.isArray(previous.repositories) ? previous.repositories.filter((value): value is string => typeof value === "string") : [];
  const added = [...(payload.repositories || []), ...(payload.repositories_added || [])].map((repository) => repository.full_name).filter((value): value is string => Boolean(value));
  const removed = new Set((payload.repositories_removed || []).map((repository) => repository.full_name).filter(Boolean));
  const repositories = [...new Set([...previousRepositories, ...added])].filter((repository) => !removed.has(repository));
  const inactive = eventType === "installation" && ["deleted", "suspend"].includes(action);
  const installationId = inactive ? undefined : payload.installation?.id || previous.installationId;
  upsertConnection({
    id: "github",
    name: "GitHub",
    description: "Pull requests, commits, changed files, reviews",
    status: inactive ? "needs_attention" : "connected",
    scope: inactive ? `${accountLogin} · access ${action}` : `${accountLogin} · ${repositories.length} ${repositories.length === 1 ? "repository" : "repositories"}`,
    lastSync: new Date().toISOString(),
    metadata: {
      ...previous,
      authType: "github_app",
      installationId,
      accountLogin,
      accountType: payload.installation?.account?.type || previous.accountType,
      repositorySelection: payload.installation?.repository_selection || previous.repositorySelection,
      repositoryCount: repositories.length,
      repositories,
      installationActive: !inactive,
    },
  });
  return { action, installationId, accountLogin, repositoryCount: repositories.length };
}

export function ingestGitHubWebhook(deliveryId: string, eventType: string, payload: GitHubWebhookPayload) {
  if (!recordWebhookDelivery(deliveryId, "github", eventType)) return { duplicate: true as const };
  try {
    let result: unknown;
    if (eventType === "installation" || eventType === "installation_repositories") result = ingestInstallation(payload, eventType);
    else if (eventType === "pull_request") {
      upsertConnection({ id: "github", name: "GitHub", description: "PRs, commits, changed files, reviews", status: "connected", scope: payload.repository?.full_name || "Connected repository", lastSync: "just now" });
      result = ingestPullRequest(payload);
    } else if (eventType === "push") {
      upsertConnection({ id: "github", name: "GitHub", description: "PRs, commits, changed files, reviews", status: "connected", scope: payload.repository?.full_name || "Connected repository", lastSync: "just now" });
      result = ingestPush(payload);
    }
    else result = { ignored: true, eventType };
    completeWebhookDelivery(deliveryId);
    return { duplicate: false as const, result };
  } catch (error) {
    completeWebhookDelivery(deliveryId, error instanceof Error ? error.message : String(error));
    throw error;
  }
}
