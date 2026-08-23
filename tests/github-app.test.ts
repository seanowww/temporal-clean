import test from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync, verify } from "node:crypto";
import { githubAppInstallationUrl, getGitHubAccessToken, resetGitHubAccessTokenCacheForTests, signGitHubAppJwt } from "../lib/github-app";
import { resetDbForTests } from "../lib/db";
import { upsertConnection } from "../lib/store";
import { auditGitHubInstallation, buildGitHubAppManifest, githubAppEnvironment } from "../lib/github-app-manifest";

process.env.TEMPORAL_DB_PATH = ":memory:";

test("GitHub App JWTs are short-lived, app-scoped, and RSA signed", () => {
  const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const now = 1_800_000_000;
  const jwt = signGitHubAppJwt({ appId: "12345", privateKey: privateKey.export({ type: "pkcs8", format: "pem" }).toString() }, now);
  const [header, payload, signature] = jwt.split(".");
  assert.deepEqual(JSON.parse(Buffer.from(header, "base64url").toString()), { alg: "RS256", typ: "JWT" });
  assert.deepEqual(JSON.parse(Buffer.from(payload, "base64url").toString()), { iat: now - 60, exp: now + 540, iss: "12345" });
  assert.equal(verify("RSA-SHA256", Buffer.from(`${header}.${payload}`), publicKey, Buffer.from(signature, "base64url")), true);
});

test("GitHub installation links preserve an opaque state value", () => {
  assert.equal(githubAppInstallationUrl("temporal-demo", "state/value"), "https://github.com/apps/temporal-demo/installations/new?state=state%2Fvalue");
});

test("GitHub manifest creates Temporal with exact delivery permissions and callbacks", () => {
  const manifest = buildGitHubAppManifest("https://temporal.example/path");
  assert.equal(manifest.name, "Temporal");
  assert.equal(manifest.hook_attributes.url, "https://temporal.example/api/webhooks/github");
  assert.equal(manifest.redirect_url, "https://temporal.example/api/setup/github/manifest/callback");
  assert.deepEqual(manifest.default_permissions, { checks: "write", contents: "read", deployments: "write", metadata: "read", pull_requests: "write" });
  assert.deepEqual(manifest.default_events, ["pull_request", "push"]);
  assert.equal(auditGitHubInstallation(manifest.default_permissions, [...manifest.default_events]).ready, true);
  assert.equal(auditGitHubInstallation({ contents: "read" }, ["push"]).ready, false);
});

test("manifest conversion stores the private key in env-safe base64", () => {
  const env = githubAppEnvironment({ id: 42, slug: "temporal", pem: "line one\nline two", webhook_secret: "secret", html_url: "https://github.com/settings/apps/temporal" });
  assert.equal(env.GITHUB_APP_ID, "42");
  assert.equal(env.GITHUB_APP_SLUG, "temporal");
  assert.equal(Buffer.from(env.GITHUB_APP_PRIVATE_KEY_BASE64, "base64").toString(), "line one\nline two");
  assert.equal(env.GITHUB_WEBHOOK_SECRET, "secret");
});

test("GitHub App installation access tokens are reused inside their validity window", async (t) => {
  resetDbForTests();
  resetGitHubAccessTokenCacheForTests();
  const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  process.env.GITHUB_APP_ID = "12345";
  process.env.GITHUB_APP_SLUG = "temporal-test";
  process.env.GITHUB_APP_PRIVATE_KEY = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
  delete process.env.GITHUB_TOKEN;
  upsertConnection({
    id: "github",
    name: "GitHub",
    description: "Pull requests",
    status: "connected",
    scope: "acme/api",
    metadata: { installationId: 99 },
  });

  const originalFetch = globalThis.fetch;
  let minted = 0;
  globalThis.fetch = (async (url) => {
    assert.match(String(url), /\/app\/installations\/99\/access_tokens$/);
    minted++;
    return Response.json({ token: `installation-token-${minted}`, expires_at: new Date(Date.now() + 55 * 60_000).toISOString() });
  }) as typeof fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
    resetDbForTests();
    resetGitHubAccessTokenCacheForTests();
    delete process.env.GITHUB_APP_ID;
    delete process.env.GITHUB_APP_SLUG;
    delete process.env.GITHUB_APP_PRIVATE_KEY;
  });

  assert.equal(await getGitHubAccessToken(), "installation-token-1");
  assert.equal(await getGitHubAccessToken(), "installation-token-1");
  assert.equal(minted, 1);
});
