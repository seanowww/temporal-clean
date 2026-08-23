import type { ConnectorId } from "./catalog";
import { ingestConnectorDump } from "./ingest";
import { ingestClaudeMem } from "../ingest/claude-mem";
import { createInstallationAccessToken, getStoredGitHubInstallationId, githubApiHeaders, githubAppConfigured, listInstallationRepositories } from "../github-app";
import { completeSyncRun, listConnections, startSyncRun, upsertConnection } from "../store";

async function apiJson(url: string, init: RequestInit) {
  const response = await fetch(url, init);
  if (!response.ok) throw new Error(`Source API returned ${response.status}: ${(await response.text()).slice(0, 240)}`);
  return response.json() as Promise<unknown>;
}

async function syncGitHub() {
  const installationId = getStoredGitHubInstallationId();
  if (installationId && githubAppConfigured()) {
    const [repositories, access] = await Promise.all([listInstallationRepositories(installationId), createInstallationAccessToken(installationId)]);
    const pulls: unknown[] = [];
    for (const repository of repositories.slice(0, 20)) {
      const result = await apiJson(`https://api.github.com/repos/${repository.full_name}/pulls?state=open&per_page=30`, { headers: githubApiHeaders(access.token) });
      pulls.push(...(Array.isArray(result) ? result.map((pull) => ({ ...(pull as Record<string, unknown>), repository: { full_name: repository.full_name } })) : []));
    }
    return { content: JSON.stringify({ pull_requests: pulls }), scope: `${repositories.length} authorized repositories` };
  }
  if (!process.env.GITHUB_TOKEN) throw new Error("Set GITHUB_TOKEN or use the file/paste importer.");
  const org = process.env.GITHUB_ORG;
  if (!org) throw new Error("Set GITHUB_ORG to sync organization pull requests.");
  const headers = githubApiHeaders(process.env.GITHUB_TOKEN);
  const repos = await apiJson(`https://api.github.com/orgs/${encodeURIComponent(org)}/repos?sort=pushed&per_page=20`, { headers }) as Array<Record<string, unknown>>;
  const pulls: unknown[] = [];
  for (const repo of repos.slice(0, 10)) {
    const name = String(repo.name || ""); if (!name) continue;
    const result = await apiJson(`https://api.github.com/repos/${encodeURIComponent(org)}/${encodeURIComponent(name)}/pulls?state=open&per_page=30`, { headers });
    pulls.push(...(Array.isArray(result) ? result.map((pull) => ({ ...(pull as Record<string, unknown>), repository: { full_name: `${org}/${name}` } })) : []));
  }
  return { content: JSON.stringify({ pull_requests: pulls }), scope: `${org} · ${repos.length} repositories` };
}

async function syncSlack() {
  if (!process.env.SLACK_BOT_TOKEN) throw new Error("Set SLACK_BOT_TOKEN or use the file/paste importer.");
  const requested = (process.env.SLACK_CHANNEL_IDS || "").split(",").map((value) => value.trim()).filter(Boolean);
  if (!requested.length) throw new Error("Set SLACK_CHANNEL_IDS to the approved channel IDs.");
  const channels: unknown[] = [];
  for (const channel of requested) {
    const result = await apiJson(`https://slack.com/api/conversations.history?channel=${encodeURIComponent(channel)}&limit=100`, { headers: { Authorization: `Bearer ${process.env.SLACK_BOT_TOKEN}` } }) as Record<string, unknown>;
    if (result.ok === false) throw new Error(`Slack rejected channel ${channel}: ${String(result.error || "unknown_error")}`);
    channels.push({ id: channel, messages: result.messages || [] });
  }
  return { content: JSON.stringify({ channels }), scope: `${requested.length} approved channels` };
}

async function syncJira() {
  const { JIRA_BASE_URL: base, JIRA_EMAIL: email, JIRA_API_TOKEN: token } = process.env;
  if (!base || !email || !token) throw new Error("Set JIRA_BASE_URL, JIRA_EMAIL, and JIRA_API_TOKEN or use the file/paste importer.");
  const projects = (process.env.JIRA_PROJECT_KEYS || "").split(",").map((value) => value.trim()).filter(Boolean);
  const jql = projects.length ? `project in (${projects.map((key) => `\"${key}\"`).join(",")}) ORDER BY updated DESC` : "updated >= -30d ORDER BY updated DESC";
  const result = await apiJson(`${base.replace(/\/$/, "")}/rest/api/3/search/jql?jql=${encodeURIComponent(jql)}&maxResults=100&fields=summary,description,status,assignee,creator,labels,created,updated`, { headers: { Authorization: `Basic ${Buffer.from(`${email}:${token}`).toString("base64")}`, Accept: "application/json" } });
  return { content: JSON.stringify(result), scope: projects.length ? projects.join(", ") : "Updated in the last 30 days" };
}

async function syncNotion() {
  if (!process.env.NOTION_TOKEN) throw new Error("Set NOTION_TOKEN or use the file/paste importer.");
  const result = await apiJson("https://api.notion.com/v1/search", { method: "POST", headers: { Authorization: `Bearer ${process.env.NOTION_TOKEN}`, "Notion-Version": "2022-06-28", "Content-Type": "application/json" }, body: JSON.stringify({ page_size: 100, sort: { direction: "descending", timestamp: "last_edited_time" } }) });
  return { content: JSON.stringify(result), scope: "Integration-visible pages" };
}

export type SyncOptions = { project?: string; since?: number; limit?: number };

export async function syncConnector(source: ConnectorId, options: SyncOptions = {}) {
  if (source === "claude-mem") {
    const result = await ingestClaudeMem(options);
    if (result.transport === "none") throw new Error("claude-mem was not detected. Run `npx claude-mem install`, or import an export file.");
    return { source, ...result, records: result.nodes };
  }
  if (source === "claude" || source === "codex") throw new Error(`${source === "claude" ? "Claude Code" : "Codex"} uses local file or paste imports.`);
  const syncRunId = startSyncRun(source, { transport: "rest", source });
  try {
    const data = source === "github" ? await syncGitHub() : source === "slack" ? await syncSlack() : source === "jira" ? await syncJira() : await syncNotion();
    const result = ingestConnectorDump(source, data.content, { connectionId: source, syncRunId, filename: `${source}-api-sync.json`, importedAt: new Date().toISOString() });
    const connection = listConnections().find((entry) => entry.id === source);
    if (connection) upsertConnection({ ...connection, status: "connected", scope: data.scope, lastSync: new Date().toISOString() });
    completeSyncRun(syncRunId, { recordsSeen: result.records, recordsWritten: result.records });
    return result;
  } catch (error) {
    completeSyncRun(syncRunId, { error: error instanceof Error ? error.message : String(error) });
    throw error;
  }
}
