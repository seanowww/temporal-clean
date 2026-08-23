import {
  getGraphNodeBySource,
  listPullRequests,
  upsertConnection,
  upsertGraphEdge,
  upsertGraphNode,
} from "../store";

export type ClaudeMessage = {
  id?: string;
  role: "user" | "assistant" | "tool";
  content: string;
  timestamp?: string;
};

export type ClaudeSessionInput = {
  sessionId: string;
  repository: string;
  branch: string;
  actor: string;
  startedAt: string;
  endedAt?: string;
  sourcePath?: string;
  messages: ClaudeMessage[];
  commitShas?: string[];
};

function validate(input: ClaudeSessionInput) {
  for (const [key, value] of Object.entries({ sessionId: input.sessionId, repository: input.repository, branch: input.branch, actor: input.actor, startedAt: input.startedAt })) {
    if (typeof value !== "string" || !value.trim()) throw new Error(`Missing ${key}`);
  }
  if (!Array.isArray(input.messages) || !input.messages.length) throw new Error("Claude session has no messages");
  for (const message of input.messages) {
    if (!["user", "assistant", "tool"].includes(message.role) || typeof message.content !== "string") throw new Error("Invalid Claude message");
  }
}

export function ingestClaudeSession(input: ClaudeSessionInput) {
  validate(input);
  upsertConnection({ id: "claude", name: "Claude Code", description: "Local sessions, decisions, tool traces", status: "connected", scope: "Active collector", lastSync: "just now" });
  const transcript = input.messages.map((message) => `${message.role}: ${message.content}`).join("\n\n");
  const sessionNodeId = upsertGraphNode({
    type: "agent_session",
    source: "claude",
    sourceId: input.sessionId,
    title: input.messages.find((message) => message.role === "user")?.content.slice(0, 96) || "Claude Code session",
    content: transcript,
    occurredAt: input.startedAt,
    actorId: input.actor,
    repository: input.repository,
    branch: input.branch,
    commitSha: input.commitShas?.[0],
    metadata: { endedAt: input.endedAt, sourcePath: input.sourcePath, commitShas: input.commitShas || [], messageCount: input.messages.length },
  });

  const messageNodeIds = input.messages.map((message, index) => {
    const messageNodeId = upsertGraphNode({
      type: message.role === "tool" ? "tool_call" : "message",
      source: "claude",
      sourceId: message.id || `${input.sessionId}:message:${index}`,
      title: `${message.role === "assistant" ? "Claude" : message.role === "user" ? input.actor : "Tool"} message`,
      content: message.content,
      occurredAt: message.timestamp || input.startedAt,
      actorId: message.role === "assistant" ? "claude" : input.actor,
      repository: input.repository,
      branch: input.branch,
      metadata: { sessionId: input.sessionId, role: message.role, position: index },
    });
    upsertGraphEdge({ fromNodeId: sessionNodeId, toNodeId: messageNodeId, type: "CONTAINS", confidence: 1 });
    return messageNodeId;
  });

  const linkedPullRequests: string[] = [];
  for (const pr of listPullRequests()) {
    if (pr.repository !== input.repository || pr.branch !== input.branch) continue;
    const prNode = getGraphNodeBySource("github", `${pr.repository}#${pr.number}`);
    if (!prNode) continue;
    upsertGraphEdge({ fromNodeId: prNode.id, toNodeId: sessionNodeId, type: "DERIVED_FROM", confidence: 1 });
    linkedPullRequests.push(pr.id);
  }

  return { sessionNodeId, messageNodeIds, linkedPullRequests };
}
