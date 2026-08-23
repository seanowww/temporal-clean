import { loadDemoArtifact } from "./artifact-source";
import { connections, pullRequests } from "./demo-data";
import {
  countArtifacts,
  ensureWorkspace,
  getPullRequest,
  listPullRequests,
  saveArtifact,
  upsertConnection,
  upsertGraphEdge,
  upsertGraphNode,
  upsertPullRequest,
} from "./store";

declare global {
  var __temporalSeedPromise: Promise<void> | undefined;
}

const openedAt = "2026-08-21T20:00:00.000Z";

async function seed() {
  const explicitlyEnabled = process.env.TEMPORAL_SEED_DEMO === "true";
  if (process.env.TEMPORAL_SEED_DEMO === "false" || (process.env.NODE_ENV === "production" && !explicitlyEnabled)) return;
  if (listPullRequests().length > 0) return;
  ensureWorkspace();
  connections.forEach((connection) => upsertConnection(connection));
  pullRequests.forEach((pr) => upsertPullRequest({
    id: pr.id,
    repository: `acme/${pr.repository}`,
    number: pr.number,
    title: pr.title,
    author: pr.author,
    branch: pr.number === 4471 ? "aria/export-idempotency-v2" : `demo/pr-${pr.number}`,
    baseBranch: "main",
    status: "open",
    openedAt,
    updatedAt: openedAt,
    artifactStatus: pr.status,
    metadata: { synthetic: true },
  }));

  if (countArtifacts("pr-4471") > 0) return;
  const artifact = await loadDemoArtifact();
  const pr = getPullRequest("pr-4471");
  if (!pr) throw new Error("Demo PR seed failed");

  const prNodeId = upsertGraphNode({
    id: "graph-pr-4471",
    type: "pull_request",
    source: "github",
    sourceId: "acme/platform-api#4471",
    title: pr.title,
    content: "Queued bulk export with job-level idempotency.",
    occurredAt: openedAt,
    actorId: pr.author,
    repository: pr.repository,
    branch: pr.branch,
    metadata: { pullRequestId: pr.id, synthetic: true },
  });

  const nodeByEvent = new Map<string, string>();
  for (const event of artifact.events) {
    const occurredAt = new Date(Date.parse(openedAt) - event.t * 24 * 60 * 60 * 1_000).toISOString();
    const nodeId = upsertGraphNode({
      id: `graph-${event.id}`,
      type: event.src === "git" ? "commit" : event.src === "claude" || event.src === "codex" ? "agent_session" : event.src === "slack" ? "message" : "document",
      source: event.src === "git" ? "github" : event.src,
      sourceId: `demo:${event.id}`,
      title: String(event.title),
      content: String(event.excerpt || event.short || ""),
      occurredAt,
      actorId: pr.author,
      repository: pr.repository,
      branch: pr.branch,
      metadata: { ...event, synthetic: true },
    });
    nodeByEvent.set(event.id, nodeId);
  }

  for (const [from, to, channel] of artifact.edges) {
    const fromNodeId = nodeByEvent.get(from);
    const toNodeId = nodeByEvent.get(to);
    if (!fromNodeId || !toNodeId) continue;
    upsertGraphEdge({ fromNodeId, toNodeId, type: channel === "pruned" ? "REJECTS" : channel === "branch" ? "DERIVED_FROM" : "PRECEDES", confidence: .95, metadata: { channel } });
  }

  for (const nodeId of nodeByEvent.values()) {
    upsertGraphEdge({ fromNodeId: prNodeId, toNodeId: nodeId, type: "CONTEXT_FOR", confidence: .9 });
  }

  saveArtifact({
    ...artifact,
    pullRequestId: "pr-4471",
    generatedAt: openedAt,
    pullRequest: { number: 4471, repository: "acme/platform-api", title: pr.title, author: pr.author, filesChanged: 14, additions: 812, deletions: 196 },
  });
}

export function ensureDemoSeed() {
  if (!globalThis.__temporalSeedPromise) globalThis.__temporalSeedPromise = seed();
  return globalThis.__temporalSeedPromise;
}

export function resetDemoSeedForTests() {
  globalThis.__temporalSeedPromise = undefined;
}
