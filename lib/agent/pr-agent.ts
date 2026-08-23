import { readFile } from "node:fs/promises";
import path from "node:path";
import { Agent, run, tool } from "@openai/agents";
import { z } from "zod";
import { assembleArtifact } from "../artifact";
import { canAccessNode, evidenceVisibleToPullRequest, traverseGraph } from "../graph";
import { getGraphNodeBySource, getPullRequest, listGraphEdges, listGraphNodes } from "../store";

const outputSchema = z.object({
  summary: z.string().min(1).max(900),
  selectedNodeIds: z.array(z.string()).max(18),
  qaFocus: z.array(z.string()).max(5),
  status: z.enum(["ready", "limited"]),
  confidence: z.number().min(0).max(1),
});

const ticketPattern = /\b[A-Z][A-Z0-9]{1,9}-\d+\b/g;

async function skillInstructions() {
  return readFile(path.join(process.cwd(), "skills", "temporal-artifact-builder", "SKILL.md"), "utf8");
}

export function crawlProvenanceGraph(pullRequestId: string) {
  const pr = getPullRequest(pullRequestId);
  if (!pr) throw new Error(`Unknown pull request ${pullRequestId}`);
  const anchor = getGraphNodeBySource("github", `${pr.repository}#${pr.number}`);
  if (!anchor) throw new Error(`Pull request ${pullRequestId} has no graph anchor`);
  const subjects = (process.env.TEMPORAL_VIEWER_SUBJECTS || "").split(",").map((value) => value.trim()).filter(Boolean);
  const accessible = listGraphNodes(pr.workspaceId).filter((node) => canAccessNode(node, subjects));
  const nodes = evidenceVisibleToPullRequest(accessible, pr.metadata?.synthetic === true);
  const edges = listGraphEdges(pr.workspaceId);
  const candidates = traverseGraph({ nodeId: anchor.id, repository: pr.repository, branch: pr.branch, author: pr.author, headSha: pr.headSha, openedAt: pr.openedAt, ticketIds: [...new Set(`${pr.title}\n${pr.body}`.match(ticketPattern) || [])] }, nodes, edges, { limit: 30 });
  return {
    pullRequest: { id: pr.id, number: pr.number, repository: pr.repository, title: pr.title, body: pr.body, author: pr.author, branch: pr.branch, headSha: pr.headSha },
    anchor: { id: anchor.id, title: anchor.title },
    evidence: candidates.map(({ node, score, depth, reasons }) => ({ id: node.id, source: node.source, type: node.type, title: node.title, excerpt: node.content.slice(0, 900), occurredAt: node.occurredAt, score, depth, reasons })),
  };
}

export async function buildArtifactWithAgent(pullRequestId: string) {
  if (!process.env.OPENAI_API_KEY) return { artifact: await assembleArtifact(pullRequestId, { useAi: false }), agent: false as const, reason: "missing_openai_key" };
  const crawl = tool({
    name: "crawl_provenance_graph",
    description: "Traverse the ACL-filtered company knowledge graph for one pull request and return bounded, scored evidence.",
    parameters: z.object({ pullRequestId: z.string() }),
    execute: async ({ pullRequestId: requested }) => {
      if (requested !== pullRequestId) throw new Error("The agent may only traverse the webhook pull request.");
      return crawlProvenanceGraph(requested);
    },
  });
  const agent = new Agent({
    name: "Temporal PR context agent",
    model: process.env.OPENAI_MODEL || "gpt-5-mini",
    instructions: await skillInstructions(),
    tools: [crawl],
    outputType: outputSchema,
  });
  const result = await run(agent, `Build the Temporal artifact plan for pull request ${pullRequestId}.`, { maxTurns: 3 });
  if (!result.finalOutput) throw new Error("The PR context agent returned no structured output.");
  const plan = result.finalOutput;
  const artifact = await assembleArtifact(pullRequestId, { selectedNodeIds: plan.selectedNodeIds, summaryOverride: plan.summary, qaFocus: plan.qaFocus, statusOverride: plan.status, model: process.env.OPENAI_MODEL || "gpt-5-mini" });
  return { artifact, agent: true as const, plan };
}

export async function buildArtifactWithAgentFallback(pullRequestId: string) {
  try { return await buildArtifactWithAgent(pullRequestId); }
  catch (error) { return { artifact: await assembleArtifact(pullRequestId, { useAi: false }), agent: false as const, reason: error instanceof Error ? error.message : String(error) }; }
}
