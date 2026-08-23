import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { getLatestArtifact, getPullRequest } from "../lib/store.ts";

const outputDirectory = path.resolve(process.argv[2] || "demo/static-artifacts");
const pullRequestIds = process.argv.slice(3).length ? process.argv.slice(3) : ["pr-1", "pr-2"];
const rendererPath = path.join(process.cwd(), "public", "artifact", "index.html");
const policyPath = path.join(process.cwd(), "demo", "static-artifact-policy.json");
const renderer = await readFile(rendererPath, "utf8");
const policy = JSON.parse(await readFile(policyPath, "utf8")) as Record<string, {
  excludeEvidenceIds?: string[];
  reason?: string;
}>;
const embeddedMarker = "const EMBEDDED_ARTIFACT = null;";
const dynamicMarker = "let remoteArtifact = null;";
const marker = renderer.includes(embeddedMarker) ? embeddedMarker : dynamicMarker;

if (!renderer.includes(marker)) throw new Error("Artifact renderer is missing a supported static export marker.");

await mkdir(outputDirectory, { recursive: true });

for (const pullRequestId of pullRequestIds) {
  const artifact = getLatestArtifact(pullRequestId);
  const pullRequest = getPullRequest(pullRequestId);
  if (!artifact || !pullRequest) throw new Error(`${pullRequestId} has no saved artifact or pull request.`);

  const exclusions = new Set(policy[pullRequestId]?.excludeEvidenceIds || []);
  const events = artifact.events.filter((event) => !exclusions.has(String(event.evidenceId || "")));
  const eventIds = new Set(events.map((event) => event.id));
  const coverageStatus = new Map(artifact.coverage.map((entry) => [entry.source.toLowerCase(), entry.status]));
  const coverageCounts = new Map<string, number>();
  for (const event of events) coverageCounts.set(event.src, (coverageCounts.get(event.src) || 0) + 1);
  const coverage = [...coverageCounts].map(([source, records]) => ({
    source,
    records,
    status: coverageStatus.get(source) || "complete",
  }));
  const embedded = {
    ...artifact,
    events,
    edges: artifact.edges.filter(([from, to]) => eventIds.has(from) && eventIds.has(to)),
    coverage,
    // The assembled artifact carries API-backed file/diff counts. The store record
    // carries identity and branch state. Merge them without replacing verified metrics.
    pullRequest: { ...pullRequest, ...artifact.pullRequest },
  };
  if (exclusions.size) {
    const removed = artifact.events.length - events.length;
    console.log(`${pullRequestId}: excluded ${removed} unrelated record(s) · ${policy[pullRequestId]?.reason || "static demo policy"}`);
  }
  const safeJson = JSON.stringify(embedded)
    .replaceAll("<", "\\u003c")
    .replaceAll("\u2028", "\\u2028")
    .replaceAll("\u2029", "\\u2029");
  const replacement = marker === embeddedMarker
    ? `const EMBEDDED_ARTIFACT = ${safeJson};`
    : `let remoteArtifact = ${safeJson};`;
  const html = renderer.replace(marker, replacement);
  const outputPath = path.join(outputDirectory, `${pullRequestId}.html`);
  await writeFile(outputPath, html, "utf8");
  console.log(`${pullRequestId} -> ${outputPath}`);
}
