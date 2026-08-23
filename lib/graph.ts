export type GraphNodeRecord = {
  id: string;
  type: string;
  source: string;
  sourceId: string;
  title: string;
  content: string;
  occurredAt: string;
  actorId?: string;
  repository?: string;
  branch?: string;
  commitSha?: string;
  sourceUrl?: string;
  acl: { policy: string; allowedSubjects: string[] };
  metadata: Record<string, unknown>;
};

export type GraphEdgeRecord = {
  fromNodeId: string;
  toNodeId: string;
  type: string;
  confidence: number;
};

export type PRTraversalSeed = {
  nodeId: string;
  repository: string;
  branch: string;
  author: string;
  headSha?: string;
  openedAt: string;
  ticketIds: string[];
  filePaths?: string[];
};

export type TraversalCandidate = {
  node: GraphNodeRecord;
  score: number;
  depth: number | null;
  reasons: string[];
};

export function isDemoNode(node: { metadata: Record<string, unknown> }) {
  return node.metadata?.synthetic === true;
}

/**
 * Seeded demo evidence and real ingested evidence share one workspace, so a real PR
 * opened against the demo repository would otherwise inherit the whole synthetic
 * timeline. Demo evidence is only ever visible to the demo PR that owns it.
 */
export function evidenceVisibleToPullRequest(nodes: GraphNodeRecord[], prIsSynthetic: boolean) {
  return prIsSynthetic ? nodes : nodes.filter((node) => !isDemoNode(node));
}

export function canAccessNode(node: GraphNodeRecord, subjects: string[]) {
  if (node.acl.policy === "workspace") return true;
  const allowed = new Set(node.acl.allowedSubjects.map(normalize));
  return subjects.some((subject) => allowed.has(normalize(subject)));
}

function normalize(value?: string) {
  return value?.trim().toLowerCase() || "";
}

const normalizePath = (value: string) => value.replace(/\\/g, "/").replace(/^\.\//, "").toLowerCase();

function stringList(value: unknown) {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string" && Boolean(entry.trim())) : [];
}

/**
 * Agent tools and GitHub disagree about path form (absolute, repo-relative, cwd-relative),
 * so a suffix or basename match counts as the same file.
 */
export function sharesFilePath(candidateFiles: string[], prFiles: string[]) {
  if (!candidateFiles.length || !prFiles.length) return false;
  const targets = prFiles.map(normalizePath);
  return candidateFiles.some((file) => {
    const normalized = normalizePath(file);
    if (!normalized) return false;
    return targets.some((target) =>
      target === normalized || target.endsWith(`/${normalized}`) || normalized.endsWith(`/${target}`),
    );
  });
}

/** File paths an evidence node touched, as recorded by connectors that track them. */
export function nodeFilePaths(node: GraphNodeRecord) {
  return {
    modified: stringList(node.metadata.filesModified),
    read: stringList(node.metadata.filesRead),
  };
}

function scoreCandidate(node: GraphNodeRecord, seed: PRTraversalSeed, depth: number | null) {
  let score = 0;
  const reasons: string[] = [];
  const nodeRepo = normalize(node.repository);
  const seedRepo = normalize(seed.repository);

  if (depth !== null) {
    const graphScore = Math.max(40, 110 - depth * 20);
    score += graphScore;
    reasons.push(`graph path depth ${depth}`);
  }
  if (node.commitSha && seed.headSha && normalize(node.commitSha) === normalize(seed.headSha)) {
    score += 90;
    reasons.push("matching commit SHA");
  }
  if (node.branch) {
    if (normalize(node.branch) === normalize(seed.branch)) {
      score += 70;
      reasons.push("matching branch");
    } else if (nodeRepo && nodeRepo === seedRepo) {
      // A record explicitly attached to another branch in the same repository is
      // evidence for another body of work, not weak evidence for this PR. Without
      // this penalty, repository + time-window alone pulled entire neighbouring PRs
      // into an otherwise unrelated artifact.
      score -= 100;
      reasons.push("conflicting branch");
    }
  }
  if (nodeRepo && nodeRepo === seedRepo) {
    score += 30;
    reasons.push("same repository");
  } else if (nodeRepo && seedRepo && nodeRepo !== seedRepo) {
    score -= 60;
    reasons.push("conflicting repository");
  }
  if (node.actorId && normalize(node.actorId) === normalize(seed.author)) {
    score += 15;
    reasons.push("same author");
  }

  const prFiles = seed.filePaths || [];
  if (prFiles.length) {
    const { modified, read } = nodeFilePaths(node);
    if (sharesFilePath(modified, prFiles)) {
      score += 50;
      reasons.push("touched a file this PR changes");
    } else if (sharesFilePath(read, prFiles)) {
      score += 25;
      reasons.push("read a file this PR changes");
    }
  }

  const searchable = `${node.title}\n${node.content}`.toLowerCase();
  for (const ticket of seed.ticketIds) {
    if (searchable.includes(ticket.toLowerCase())) {
      score += 55;
      reasons.push(`mentions ${ticket}`);
      break;
    }
  }

  const occurred = Date.parse(node.occurredAt);
  const opened = Date.parse(seed.openedAt);
  const windowStart = opened - 14 * 24 * 60 * 60 * 1_000;
  if (Number.isFinite(occurred) && occurred >= windowStart && occurred <= opened + 60 * 60 * 1_000) {
    score += 15;
    reasons.push("inside PR development window");
  }

  return { score, reasons };
}

export function traverseGraph(
  seed: PRTraversalSeed,
  nodes: GraphNodeRecord[],
  edges: GraphEdgeRecord[],
  options: { maxDepth?: number; minimumScore?: number; limit?: number } = {},
) {
  const maxDepth = options.maxDepth ?? 3;
  const minimumScore = options.minimumScore ?? 25;
  const limit = options.limit ?? 50;
  const adjacency = new Map<string, Set<string>>();
  for (const edge of edges) {
    if (!adjacency.has(edge.fromNodeId)) adjacency.set(edge.fromNodeId, new Set());
    if (!adjacency.has(edge.toNodeId)) adjacency.set(edge.toNodeId, new Set());
    adjacency.get(edge.fromNodeId)!.add(edge.toNodeId);
    adjacency.get(edge.toNodeId)!.add(edge.fromNodeId);
  }

  const depths = new Map<string, number>([[seed.nodeId, 0]]);
  let frontier = [seed.nodeId];
  for (let depth = 1; depth <= maxDepth; depth++) {
    const next: string[] = [];
    for (const id of frontier) {
      for (const neighbour of adjacency.get(id) || []) {
        if (depths.has(neighbour)) continue;
        depths.set(neighbour, depth);
        next.push(neighbour);
      }
    }
    frontier = next;
  }

  return nodes
    .filter((node) => node.id !== seed.nodeId)
    .map((node): TraversalCandidate => {
      const depth = depths.get(node.id) ?? null;
      const { score, reasons } = scoreCandidate(node, seed, depth);
      return { node, score, depth, reasons };
    })
    .filter((candidate) => !candidate.reasons.includes("conflicting branch"))
    .filter((candidate) => candidate.score >= minimumScore)
    .sort((a, b) => b.score - a.score || Date.parse(a.node.occurredAt) - Date.parse(b.node.occurredAt))
    .slice(0, limit);
}
