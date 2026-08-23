import { appendFile, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

export const temporalGitHubPermissions = {
  checks: "write", contents: "read", deployments: "write", metadata: "read", pull_requests: "write",
} as const;
export const temporalGitHubEvents = ["pull_request", "push"] as const;

export function buildGitHubAppManifest(appUrl: string) {
  const origin = new URL(appUrl).origin;
  return {
    name: "Temporal", url: origin, description: "The context timeline behind every pull request.",
    hook_attributes: { url: `${origin}/api/webhooks/github`, active: true },
    redirect_url: `${origin}/api/setup/github/manifest/callback`,
    setup_url: `${origin}/api/auth/github/callback`, setup_on_update: true, public: false,
    default_permissions: temporalGitHubPermissions, default_events: temporalGitHubEvents,
  };
}

export type GitHubManifestConversion = { id: number; slug: string; pem: string; webhook_secret: string; html_url: string };
const generatedKeys = ["GITHUB_APP_ID", "GITHUB_APP_SLUG", "GITHUB_APP_PRIVATE_KEY_BASE64", "GITHUB_WEBHOOK_SECRET"] as const;

export function githubAppEnvironment(conversion: GitHubManifestConversion) {
  return { GITHUB_APP_ID: String(conversion.id), GITHUB_APP_SLUG: conversion.slug, GITHUB_APP_PRIVATE_KEY_BASE64: Buffer.from(conversion.pem).toString("base64"), GITHUB_WEBHOOK_SECRET: conversion.webhook_secret };
}

/** Persist only generated keys, preserving every unrelated local setting. */
export async function saveLocalGitHubAppEnvironment(conversion: GitHubManifestConversion, cwd = process.cwd()) {
  if (process.env.NODE_ENV === "production") throw new Error("Local environment setup is disabled in production");
  const envPath = path.join(cwd, ".env.local");
  let existing = "";
  try { existing = await readFile(envPath, "utf8"); } catch { await appendFile(envPath, "", { mode: 0o600 }); }
  const values = githubAppEnvironment(conversion);
  const kept = existing.split(/\r?\n/).filter((line) => !generatedKeys.some((key) => line.startsWith(`${key}=`)) && line.length);
  await writeFile(envPath, `${kept.join("\n")}\n${generatedKeys.map((key) => `${key}=${values[key]}`).join("\n")}\n`, { mode: 0o600 });
  Object.assign(process.env, values);
}

export function auditGitHubInstallation(permissions: Record<string, string> = {}, events: string[] = []) {
  const missingPermissions = Object.entries(temporalGitHubPermissions).filter(([name, level]) => permissions[name] !== level).map(([name, level]) => `${name}:${level}`);
  const missingEvents = temporalGitHubEvents.filter((event) => !events.includes(event));
  return { ready: missingPermissions.length === 0 && missingEvents.length === 0, missingPermissions, missingEvents };
}
