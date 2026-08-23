import { createSign } from "node:crypto";
import { listConnections } from "./store";

const apiVersion = process.env.GITHUB_API_VERSION || "2026-03-10";
const apiBase = "https://api.github.com";

export type GitHubAppConfig = { appId: string; slug: string; privateKey: string };
export type GitHubInstallation = {
  id: number;
  account: { login: string; type: string; avatar_url?: string };
  repository_selection: "all" | "selected";
  html_url?: string;
  target_type?: string;
  permissions?: Record<string, string>;
  events?: string[];
};
export type GitHubRepository = { id: number; full_name: string; private: boolean; html_url: string };

function decodePrivateKey() {
  const encoded = process.env.GITHUB_APP_PRIVATE_KEY_BASE64;
  if (encoded) return Buffer.from(encoded, "base64").toString("utf8");
  return process.env.GITHUB_APP_PRIVATE_KEY?.replace(/\\n/g, "\n") || "";
}

export function getGitHubAppConfig(): GitHubAppConfig | null {
  const appId = process.env.GITHUB_APP_ID?.trim();
  const slug = process.env.GITHUB_APP_SLUG?.trim();
  const privateKey = decodePrivateKey();
  return appId && slug && privateKey ? { appId, slug, privateKey } : null;
}

export function githubAppConfigured() {
  return Boolean(getGitHubAppConfig());
}

const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");

export function signGitHubAppJwt(config: Pick<GitHubAppConfig, "appId" | "privateKey">, nowSeconds = Math.floor(Date.now() / 1_000)) {
  const header = encode({ alg: "RS256", typ: "JWT" });
  const payload = encode({ iat: nowSeconds - 60, exp: nowSeconds + 9 * 60, iss: config.appId });
  const unsigned = `${header}.${payload}`;
  const signer = createSign("RSA-SHA256");
  signer.update(unsigned); signer.end();
  return `${unsigned}.${signer.sign(config.privateKey).toString("base64url")}`;
}

export function githubAppInstallationUrl(slug: string, state: string) {
  return `https://github.com/apps/${encodeURIComponent(slug)}/installations/new?state=${encodeURIComponent(state)}`;
}

async function githubJson<T>(path: string, token: string, init: RequestInit = {}) {
  const response = await fetch(`${apiBase}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": apiVersion,
      ...(init.body ? { "Content-Type": "application/json" } : {}),
      ...init.headers,
    },
  });
  if (!response.ok) throw new Error(`GitHub API ${response.status}: ${(await response.text()).slice(0, 240)}`);
  return response.json() as Promise<T>;
}

function appJwt() {
  const config = getGitHubAppConfig();
  if (!config) throw new Error("GitHub App credentials are not configured");
  return signGitHubAppJwt(config);
}

export async function getGitHubInstallation(installationId: number) {
  return githubJson<GitHubInstallation>(`/app/installations/${installationId}`, appJwt());
}

export async function createInstallationAccessToken(installationId: number) {
  return githubJson<{ token: string; expires_at: string }>(`/app/installations/${installationId}/access_tokens`, appJwt(), { method: "POST", body: "{}" });
}

export async function listInstallationRepositories(installationId: number) {
  const { token } = await createInstallationAccessToken(installationId);
  const repositories: GitHubRepository[] = [];
  for (let page = 1; page <= 10; page++) {
    const result = await githubJson<{ total_count: number; repositories: GitHubRepository[] }>(`/installation/repositories?per_page=100&page=${page}`, token);
    repositories.push(...result.repositories);
    if (result.repositories.length < 100 || repositories.length >= result.total_count) break;
  }
  return repositories;
}

export function getStoredGitHubInstallationId() {
  const value = listConnections().find((connection) => connection.id === "github")?.metadata?.installationId;
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : null;
}

type CachedInstallationToken = { token: string; expiresAtMs: number };
const installationTokenCache = new Map<number, CachedInstallationToken>();
let cachedStoredInstallationId: number | null = null;
const installationTokenRefreshSkewMs = 60_000;

export function resetGitHubAccessTokenCacheForTests() {
  installationTokenCache.clear();
  cachedStoredInstallationId = null;
}

export async function getGitHubAccessToken() {
  const installationId = getStoredGitHubInstallationId();
  if (installationId !== cachedStoredInstallationId) {
    installationTokenCache.clear();
    cachedStoredInstallationId = installationId;
  }
  if (installationId && githubAppConfigured()) {
    const cached = installationTokenCache.get(installationId);
    if (cached && cached.expiresAtMs - installationTokenRefreshSkewMs > Date.now()) return cached.token;
    const created = await createInstallationAccessToken(installationId);
    installationTokenCache.set(installationId, { token: created.token, expiresAtMs: Date.parse(created.expires_at) });
    return created.token;
  }
  return process.env.GITHUB_TOKEN || null;
}

/**
 * Which identity Temporal is acting as.
 *  - "app"   — installation token; GitHub attributes writes to `<slug>[bot]`, which is
 *              the identity this product is supposed to have (CodeRabbit, Bugbot, …).
 *  - "token" — a personal access token; writes are attributed to a human being, and
 *              Check Runs are not available to PATs at all.
 */
export function githubAuthMode(): "app" | "token" | "none" {
  if (getStoredGitHubInstallationId() && githubAppConfigured()) return "app";
  return process.env.GITHUB_TOKEN ? "token" : "none";
}

/** The bot login GitHub will attribute app writes to. */
export function githubBotLogin() {
  const slug = getGitHubAppConfig()?.slug;
  return slug ? `${slug}[bot]` : null;
}

export function githubApiHeaders(token: string) {
  return { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": apiVersion };
}

/**
 * Pull request webhooks carry only a changed-file count, but file paths are the strongest
 * signal for linking agent memory to a PR. Returns an empty list when GitHub is
 * unreachable so artifact assembly stays deterministic and offline-safe.
 */
export async function listPullRequestFiles(repository: string, number: number, maxPages = 3) {
  let token: string | null = null;
  try { token = await getGitHubAccessToken(); }
  catch { return []; }
  if (!token) return [];
  const files: string[] = [];
  try {
    for (let page = 1; page <= maxPages; page++) {
      const result = await githubJson<Array<{ filename?: string }>>(`/repos/${repository}/pulls/${number}/files?per_page=100&page=${page}`, token);
      files.push(...result.map((file) => file.filename).filter((name): name is string => Boolean(name)));
      if (result.length < 100) break;
    }
  } catch {
    return files;
  }
  return files;
}
