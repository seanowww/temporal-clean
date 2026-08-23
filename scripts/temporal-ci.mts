import { execFileSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import type { ArtifactPayload } from "../lib/types.ts";
import type { EvidenceManifest } from "../lib/committed-evidence.ts";

const eventPath = process.env.GITHUB_EVENT_PATH;
if (!eventPath) throw new Error("GITHUB_EVENT_PATH is required; run this command from a pull_request workflow");
const payload = JSON.parse(await readFile(eventPath, "utf8"));
if (!payload.pull_request || !payload.repository?.full_name) throw new Error("Temporal CI requires a GitHub pull_request event payload");

process.env.TEMPORAL_DB_PATH = ":memory:";
process.env.TEMPORAL_SEED_DEMO = "false";
delete process.env.GITHUB_APP_ID;
delete process.env.GITHUB_APP_PRIVATE_KEY;
delete process.env.GITHUB_APP_PRIVATE_KEY_BASE64;
delete process.env.GITHUB_TOKEN;

const [{ ingestGitHubWebhook }, { assembleArtifact }, store, evidence] = await Promise.all([
  import("../lib/ingest/github.ts"),
  import("../lib/artifact.ts"),
  import("../lib/store.ts"),
  import("../lib/committed-evidence.ts"),
]);

const evidenceDirectory = path.resolve(process.env.TEMPORAL_EVIDENCE_DIR || ".temporal/evidence");
let evidenceCount = 0;
try {
  const [manifestText, recordsJsonl, edgesJsonl] = await Promise.all([
    readFile(path.join(evidenceDirectory, "manifest.json"), "utf8"),
    readFile(path.join(evidenceDirectory, "records.jsonl"), "utf8"),
    readFile(path.join(evidenceDirectory, "edges.jsonl"), "utf8"),
  ]);
  const manifest = JSON.parse(manifestText) as EvidenceManifest;
  if (manifest.version !== 1) throw new Error(`Unsupported Temporal evidence version: ${manifest.version}`);
  if (manifest.repository.toLowerCase() !== payload.repository.full_name.toLowerCase()) {
    throw new Error(`Evidence is scoped to ${manifest.repository}, not ${payload.repository.full_name}`);
  }
  const parsed = evidence.parseCommittedEvidence(recordsJsonl, edgesJsonl, manifest.digest);
  for (const node of parsed.nodes) store.upsertGraphNode({ ...node, acl: { policy: "workspace", allowedSubjects: [] } });
  for (const edge of parsed.edges) store.upsertGraphEdge(edge);
  evidenceCount = parsed.nodes.length;
} catch (error) {
  const missing = error instanceof Error && "code" in error && error.code === "ENOENT";
  if (!missing) throw error;
}

const deliveryId = process.env.GITHUB_RUN_ID ? `actions-${process.env.GITHUB_RUN_ID}-${process.env.GITHUB_RUN_ATTEMPT || "1"}` : `local-${Date.now()}`;
const ingested = ingestGitHubWebhook(deliveryId, "pull_request", payload);
if (ingested.duplicate) throw new Error("Temporal CI event was unexpectedly treated as a duplicate");
const pullRequestId = (ingested.result as { pullRequestId?: string }).pullRequestId;
if (!pullRequestId) throw new Error("Temporal could not create the pull request anchor");

let changedFiles: string[] = [];
try {
  const baseSha = payload.pull_request.base?.sha;
  const headSha = payload.pull_request.head?.sha;
  if (baseSha && headSha) changedFiles = execFileSync("git", ["diff", "--name-only", baseSha, headSha], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).split(/\r?\n/).filter(Boolean);
} catch {
  // The deterministic traversal still has repository, branch, ticket, and commit signals.
}

const artifact = await assembleArtifact(pullRequestId, { useAi: false, filePaths: changedFiles });
const outputDirectory = path.resolve(process.env.TEMPORAL_CI_OUTPUT || "temporal-artifact");
await mkdir(outputDirectory, { recursive: true });

const renderer = await readFile(path.resolve("public/artifact/index.html"), "utf8");
const marker = "let remoteArtifact = null;";
if (!renderer.includes(marker)) throw new Error("Artifact renderer is missing its static export marker");
const safeJson = JSON.stringify(artifact).replaceAll("<", "\\u003c").replaceAll("\u2028", "\\u2028").replaceAll("\u2029", "\\u2029");
const html = renderer.replace(marker, `let remoteArtifact = ${safeJson};`);
const artifactName = `temporal-pr-${payload.pull_request.number}`;
const runUrl = `${process.env.GITHUB_SERVER_URL || "https://github.com"}/${payload.repository.full_name}/actions/runs/${process.env.GITHUB_RUN_ID || ""}`;
const summary = formatSummary(artifact, evidenceCount, runUrl);
const comment = formatComment(artifact, evidenceCount, runUrl, artifactName);

await Promise.all([
  writeFile(path.join(outputDirectory, `pr-${payload.pull_request.number}.html`), html, "utf8"),
  writeFile(path.join(outputDirectory, "artifact.json"), `${JSON.stringify(artifact, null, 2)}\n`, "utf8"),
  writeFile(path.join(outputDirectory, "summary.md"), summary, "utf8"),
  writeFile(path.join(outputDirectory, "comment.md"), comment, "utf8"),
]);

console.log(`Temporal assembled ${artifact.events.length} events from ${artifact.coverage.length} sources (${evidenceCount} committed evidence records).`);

function text(value: unknown, fallback = "") {
  return typeof value === "string" && value.trim() ? value.trim().replace(/\s+/g, " ") : fallback;
}

function qaChecks(artifact: ArtifactPayload) {
  return [...new Set(artifact.events.flatMap((event) => Array.isArray(event.tests) ? event.tests.filter((item): item is string => typeof item === "string") : []))].slice(0, 5);
}

function formatSummary(artifact: ArtifactPayload, committed: number, runUrl: string) {
  const sources = artifact.coverage.map((entry) => `${entry.source} (${entry.records})`).join(" · ") || "GitHub";
  const events = artifact.events.slice(0, 6).map((event) => `- **${text(event.title, "Evidence record")}** — ${text(event.stamp, event.src)}`);
  const checks = qaChecks(artifact).map((check) => `- ${check}`);
  return [
    "# Temporal timeline", "", artifact.summary, "", `**Sources:** ${sources}`, `**Committed evidence:** ${committed} records`, "",
    "## Key context", "", ...(events.length ? events : ["- No matching committed evidence; this run contains GitHub PR context only."]), "",
    "## Verify", "", ...(checks.length ? checks : ["- Review the changed files against the PR description."]), "",
    `[Workflow run](${runUrl})`, "",
  ].join("\n");
}

function formatComment(artifact: ArtifactPayload, committed: number, runUrl: string, artifactName: string) {
  const sources = artifact.coverage.map((entry) => entry.source).join(" · ") || "GitHub";
  const events = artifact.events.filter((event) => event.src !== "git").slice(0, 5).map((event) => `- **${text(event.title, "Evidence record")}** — ${text(event.stamp, event.src)}`);
  const checks = qaChecks(artifact).map((check) => `- ${check}`);
  return [
    "<!-- temporal-actions-artifact -->", "## Temporal timeline", "", artifact.summary, "", `**Sources:** ${sources} · **Committed evidence:** ${committed}`, "",
    "### Key context", "", ...(events.length ? events : ["- GitHub PR context only; export local evidence to enrich this timeline."]), "",
    "### Verify", "", ...(checks.length ? checks : ["- Review the changed files against the PR description."]), "",
    `**[Download the interactive timeline from this workflow run →](${runUrl}#artifacts)**`, "", `<sub>Artifact: \`${artifactName}\` · Updated for \`${payload.pull_request.head.sha.slice(0, 7)}\`</sub>`, "",
  ].join("\n");
}
