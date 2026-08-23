import { getGitHubAccessToken, githubApiHeaders } from "../github-app";
import { getGraphNodeBySource, getPullRequest, upsertGraphEdge, upsertGraphNode, upsertPullRequest } from "../store";

type ApiCommit = {
  sha?: string;
  html_url?: string;
  commit?: { message?: string; author?: { name?: string; date?: string } };
  author?: { login?: string };
};

type ApiFile = { filename?: string; status?: string; additions?: number; deletions?: number };

type ApiPullRequest = {
  changed_files?: number;
  additions?: number;
  deletions?: number;
  commits?: number;
  merged?: boolean;
  head?: { sha?: string };
};

export type BackfillResult = {
  backfilled: boolean;
  reason?: string;
  commits?: number;
  files?: number;
  changedFiles?: number;
};

async function json<T>(url: string, headers: Record<string, string>) {
  const response = await fetch(url, { headers });
  if (!response.ok) throw new Error(`${url.replace("https://api.github.com", "")} → ${response.status} ${(await response.text()).slice(0, 200)}`);
  return await response.json() as T;
}

async function paginated<T>(url: string, headers: Record<string, string>) {
  const items: T[] = [];
  for (let page = 1; ; page++) {
    const separator = url.includes("?") ? "&" : "?";
    const batch = await json<T[]>(`${url}${separator}per_page=100&page=${page}`, headers);
    items.push(...batch);
    if (batch.length < 100) return items;
  }
}

/**
 * A webhook payload describes the PR, not its history. Without this, a golden PR with
 * six existing commits reconstructs as a single anchor node, because commit evidence
 * only ever arrived through separate `push` deliveries.
 *
 * Commit nodes use the same `repo@sha` source id as push ingestion, so the two paths
 * converge on one node instead of duplicating.
 */
export async function backfillPullRequestFromApi(pullRequestId: string, authToken?: string | null): Promise<BackfillResult> {
  const pr = getPullRequest(pullRequestId);
  if (!pr) return { backfilled: false, reason: "unknown_pull_request" };
  const token = authToken === undefined ? await getGitHubAccessToken() : authToken;
  if (!token) return { backfilled: false, reason: "missing_github_auth" };
  const headers = githubApiHeaders(token);

  const anchor = getGraphNodeBySource("github", `${pr.repository}#${pr.number}`);
  if (!anchor) return { backfilled: false, reason: "missing_anchor" };

  const base = `https://api.github.com/repos/${pr.repository}/pulls/${pr.number}`;
  const [detail, commits, files] = await Promise.all([
    json<ApiPullRequest>(base, headers),
    paginated<ApiCommit>(`${base}/commits`, headers),
    paginated<ApiFile>(`${base}/files`, headers),
  ]);

  for (const commit of commits) {
    const sha = commit.sha;
    if (!sha) continue;
    const message = commit.commit?.message || "Commit";
    const nodeId = upsertGraphNode({
      type: "commit",
      source: "github",
      sourceId: `${pr.repository}@${sha}`,
      title: message.split("\n")[0].slice(0, 120),
      content: message,
      occurredAt: commit.commit?.author?.date || pr.openedAt,
      actorId: commit.author?.login || commit.commit?.author?.name,
      repository: pr.repository,
      branch: pr.branch,
      commitSha: sha,
      sourceUrl: commit.html_url,
      metadata: { backfilledFrom: "pulls/commits", shortSha: sha.slice(0, 7) },
    });
    upsertGraphEdge({ fromNodeId: anchor.id, toNodeId: nodeId, type: "CONTAINS", confidence: 1 });
  }

  const changedFiles = detail.changed_files ?? files.length;
  const additions = detail.additions ?? files.reduce((sum, file) => sum + (file.additions || 0), 0);
  const deletions = detail.deletions ?? files.reduce((sum, file) => sum + (file.deletions || 0), 0);

  upsertPullRequest({
    ...pr,
    headSha: detail.head?.sha || pr.headSha,
    metadata: { ...pr.metadata, commitCount: detail.commits ?? commits.length, filesChanged: changedFiles, additions, deletions, backfilledAt: new Date().toISOString() },
  });

  return { backfilled: true, commits: commits.length, files: files.length, changedFiles };
}
