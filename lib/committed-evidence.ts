import { createHash } from "node:crypto";
import type { GraphEdgeRecord, GraphNodeRecord } from "./graph";
import { stripPrivate } from "./claude-mem/normalize";

const forbiddenSecret = /(?:gh[opusr]_[A-Za-z0-9_]{20,}|github_pat_[A-Za-z0-9_]{20,}|sk-[A-Za-z0-9]{20,}|xox[baprs]-[A-Za-z0-9-]{10,}|AKIA[A-Z0-9]{16}|AIza[A-Za-z0-9_-]{20,}|-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----)/;
const privateTag = /<private>[\s\S]*?<\/private>/i;
const allowedMetadata = new Set(["filesModified", "filesRead", "observationType", "platformSource", "project", "sessionId", "ticketId", "channel", "threadTs"]);

export type CommittedEvidenceNode = Omit<GraphNodeRecord, "acl" | "metadata" | "sourceUrl"> & {
  metadata: Record<string, string | number | boolean | string[]>;
};

export type EvidenceManifest = {
  version: 1;
  repository: string;
  exportedAt: string;
  records: number;
  edges: number;
  excluded: { restricted: number; synthetic: number; otherRepository: number };
  digest: string;
};

function cleanText(value: string | undefined) {
  return stripPrivate(value).replaceAll("\u0000", "");
}

function safeMetadata(metadata: Record<string, unknown>) {
  const result: Record<string, string | number | boolean | string[]> = {};
  for (const [key, value] of Object.entries(metadata)) {
    if (!allowedMetadata.has(key)) continue;
    if (["string", "number", "boolean"].includes(typeof value)) result[key] = typeof value === "string" ? cleanText(value) : value as number | boolean;
    else if (Array.isArray(value) && value.every((entry) => typeof entry === "string")) result[key] = value.map(cleanText).filter(Boolean);
  }
  return result;
}

export function assertCommittedEvidenceSafe(value: unknown) {
  const serialized = JSON.stringify(value);
  if (privateTag.test(serialized)) throw new Error("Committed evidence still contains a <private> block");
  if (forbiddenSecret.test(serialized)) throw new Error("Committed evidence resembles a credential or private key");
}

export function prepareCommittedEvidence(nodes: GraphNodeRecord[], edges: GraphEdgeRecord[], repository: string, exportedAt = new Date().toISOString()) {
  const excluded = { restricted: 0, synthetic: 0, otherRepository: 0 };
  const selected: CommittedEvidenceNode[] = [];
  for (const node of nodes) {
    if (node.acl.policy !== "workspace") { excluded.restricted++; continue; }
    if (node.metadata.synthetic === true) { excluded.synthetic++; continue; }
    if (!node.repository || node.repository.toLowerCase() !== repository.toLowerCase()) { excluded.otherRepository++; continue; }
    if (node.source === "github" || node.type === "pull_request") continue;
    const record: CommittedEvidenceNode = {
      id: node.id,
      type: node.type,
      source: node.source,
      sourceId: node.sourceId,
      title: cleanText(node.title),
      content: cleanText(node.content),
      occurredAt: node.occurredAt,
      actorId: node.actorId ? cleanText(node.actorId) : undefined,
      repository: node.repository,
      branch: node.branch,
      commitSha: node.commitSha,
      metadata: safeMetadata(node.metadata),
    };
    assertCommittedEvidenceSafe(record);
    selected.push(record);
  }
  const ids = new Set(selected.map((node) => node.id));
  const selectedEdges = edges.filter((edge) => ids.has(edge.fromNodeId) && ids.has(edge.toNodeId));
  const recordsJsonl = selected.map((record) => JSON.stringify(record)).join("\n") + (selected.length ? "\n" : "");
  const edgesJsonl = selectedEdges.map((edge) => JSON.stringify(edge)).join("\n") + (selectedEdges.length ? "\n" : "");
  const digest = createHash("sha256").update(recordsJsonl).update(edgesJsonl).digest("hex");
  const manifest: EvidenceManifest = { version: 1, repository, exportedAt, records: selected.length, edges: selectedEdges.length, excluded, digest };
  return { nodes: selected, edges: selectedEdges, recordsJsonl, edgesJsonl, manifest };
}

export function parseCommittedEvidence(recordsJsonl: string, edgesJsonl: string, expectedDigest?: string) {
  if (expectedDigest) {
    const actual = createHash("sha256").update(recordsJsonl).update(edgesJsonl).digest("hex");
    if (actual !== expectedDigest) throw new Error("Committed evidence digest does not match its manifest");
  }
  const lines = (value: string) => value.split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line) as unknown);
  const nodes = lines(recordsJsonl) as CommittedEvidenceNode[];
  const edges = lines(edgesJsonl) as GraphEdgeRecord[];
  assertCommittedEvidenceSafe({ nodes, edges });
  for (const node of nodes) {
    if (!node.id || !node.source || !node.sourceId || !node.type || !node.occurredAt) throw new Error("Committed evidence contains an incomplete node");
  }
  return { nodes, edges };
}
