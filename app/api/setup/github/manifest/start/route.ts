import { randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { buildGitHubAppManifest } from "@/lib/github-app-manifest";

export const runtime = "nodejs";
const escapeAttribute = (value: string) => value.replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;");

export async function GET(request: Request) {
  if (process.env.NODE_ENV === "production") return Response.redirect(new URL("/connections?github=manifest_local_only", request.url));
  const appUrl = process.env.TEMPORAL_APP_URL || new URL(request.url).origin;
  const state = randomBytes(32).toString("base64url");
  (await cookies()).set("temporal_github_manifest_state", state, { httpOnly: true, sameSite: "lax", secure: new URL(appUrl).protocol === "https:", path: "/api/setup/github/manifest/callback", maxAge: 600 });
  const manifest = escapeAttribute(JSON.stringify(buildGitHubAppManifest(appUrl)));
  return new Response(`<!doctype html><html><head><meta charset="utf-8"><title>Creating Temporal…</title></head><body><p>Opening GitHub…</p><form id="manifest" method="post" action="https://github.com/settings/apps/new"><input type="hidden" name="state" value="${escapeAttribute(state)}"><input type="hidden" name="manifest" value="${manifest}"></form><script>document.getElementById('manifest').submit()</script></body></html>`, { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "Content-Security-Policy": "default-src 'none'; script-src 'unsafe-inline'; form-action https://github.com" } });
}
