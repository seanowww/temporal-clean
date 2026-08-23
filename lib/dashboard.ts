import { getLatestArtifact, graphStats, listConnections, listGraphEdges, listGraphNodes, listPullRequests } from "./store";
import { ensureDemoSeed } from "./seed";
import { connections as supportedConnections } from "./demo-data";
import { canAccessNode } from "./graph";
import type { PullRequestRecord } from "./types";

export async function getDashboardData() {
  await ensureDemoSeed();
  const viewerSubjects = (process.env.TEMPORAL_VIEWER_SUBJECTS || "").split(",").map((subject) => subject.trim()).filter(Boolean);
  const nodes = listGraphNodes().filter((node) => canAccessNode(node, viewerSubjects));
  const nodeIds = new Set(nodes.map((node) => node.id));
  const edges = listGraphEdges().filter((edge) => nodeIds.has(edge.fromNodeId) && nodeIds.has(edge.toNodeId));
  const stats = graphStats();
  const storedConnections = listConnections();
  const storedById = new Map(storedConnections.map((connection) => [connection.id, connection]));
  const supportedIds = new Set(supportedConnections.map((connection) => connection.id));
  const connections = [
    ...supportedConnections.map((supported) => storedById.get(supported.id) || { ...supported, status: "planned" as const, scope: "Not configured", lastSync: undefined }),
    ...storedConnections.filter((connection) => !supportedIds.has(connection.id)),
  ];
  const storedPullRequests = listPullRequests();
  const pullRequests: PullRequestRecord[] = storedPullRequests.map((pr) => {
    const related = nodes.filter((node) => node.repository === pr.repository && (!node.branch || node.branch === pr.branch));
    const artifact = getLatestArtifact(pr.id);
    const eventCount = artifact?.events.length ?? related.filter((node) => node.type !== "pull_request").length;
    const sourceCount = artifact?.coverage.length ?? new Set(related.map((node) => node.source)).size;
    return {
      id: pr.id,
      number: pr.number,
      repository: pr.repository.replace(/^.*\//, ""),
      title: pr.title,
      author: pr.author,
      status: pr.artifactStatus,
      eventCount,
      sourceCount,
      updatedAt: pr.artifactStatus === "building" ? "traversing graph" : new Date(pr.updatedAt).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }),
      synthetic: pr.metadata?.synthetic === true,
      countLabel: artifact ? "artifact events" : "related nodes",
    };
  });

  const connected = connections.filter((connection) => connection.status === "connected").length;
  const graphNodes = nodes.slice(0, 42).map((node) => ({
    id: node.id,
    source: node.source,
    type: node.type,
    title: node.title,
    relatedPullRequestIds: storedPullRequests
      .filter((pr) => node.repository === pr.repository && (
        node.metadata?.pullRequestId === pr.id ||
        node.branch === pr.branch ||
        node.type === "pull_request" ||
        !node.branch
      ))
      .map((pr) => pr.id),
  }));
  for (const pr of storedPullRequests) {
    if (graphNodes.some((node) => node.relatedPullRequestIds.includes(pr.id) && node.type === "pull_request")) continue;
    graphNodes.push({ id: `virtual:${pr.id}`, source: "github", type: "pull_request", title: `PR #${pr.number}: ${pr.title}`, relatedPullRequestIds: [pr.id] });
  }
  const visibleGraphNodeIds = new Set(graphNodes.map((node) => node.id));
  return {
    workspace: { id: "acme", name: "Acme Engineering" },
    connections,
    pullRequests,
    graphHealth: {
      records: stats.records,
      linkedSessions: stats.records ? Math.round((stats.linkedRecords / stats.records) * 100) : 0,
      unlinkedSessions: stats.unlinkedSessions,
      sourceCoverage: connections.length ? Math.round((connected / connections.length) * 100) : 0,
    },
    graph: {
      nodes: graphNodes,
      edges: edges
        .filter((edge) => visibleGraphNodeIds.has(edge.fromNodeId) && visibleGraphNodeIds.has(edge.toNodeId))
        .map((edge) => ({ from: edge.fromNodeId, to: edge.toNodeId, type: edge.type })),
    },
    synthetic: storedPullRequests.some((pr) => pr.metadata?.synthetic === true),
  };
}
