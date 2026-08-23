import type { Connection, PullRequestRecord } from "./types";

export const connections: Connection[] = [
  {
    id: "github",
    name: "GitHub",
    description: "PRs, commits, changed files, reviews",
    status: "connected",
    scope: "12 repositories",
    lastSync: "18 seconds ago",
  },
  {
    id: "claude",
    name: "Claude Code",
    description: "Local sessions, decisions, tool traces",
    status: "connected",
    scope: "8 active collectors",
    lastSync: "2 minutes ago",
  },
  {
    id: "claude-mem",
    name: "claude-mem",
    description: "Compressed agent decisions, discoveries, session summaries",
    status: "planned",
    scope: "Not configured",
  },
  {
    id: "slack",
    name: "Slack",
    description: "Approved channels and linked threads",
    status: "connected",
    scope: "4 approved channels",
    lastSync: "1 minute ago",
  },
  {
    id: "notion",
    name: "Notion",
    description: "Plans, requirements, page revisions",
    status: "planned",
    scope: "Not configured",
  },
  {
    id: "jira",
    name: "Jira",
    description: "Issues, acceptance criteria, project decisions",
    status: "planned",
    scope: "Not configured",
  },
  {
    id: "codex",
    name: "Codex",
    description: "Task transcripts, edits, and implementation decisions",
    status: "planned",
    scope: "File or pasted chat dump",
  },
];

export const pullRequests: PullRequestRecord[] = [
  {
    id: "pr-4471",
    number: 4471,
    repository: "platform-api",
    title: "feat(exports): queue-backed bulk export",
    author: "Aria K.",
    status: "ready",
    eventCount: 15,
    sourceCount: 5,
    updatedAt: "28 seconds ago",
  },
  {
    id: "pr-4470",
    number: 4470,
    repository: "web-dashboard",
    title: "Improve export progress recovery",
    author: "Mina C.",
    status: "building",
    eventCount: 7,
    sourceCount: 3,
    updatedAt: "Traversing graph",
  },
  {
    id: "pr-4468",
    number: 4468,
    repository: "auth-service",
    title: "Rotate session token signing keys",
    author: "Dev O.",
    status: "limited",
    eventCount: 5,
    sourceCount: 2,
    updatedAt: "Claude collector unavailable",
  },
];

export const graphHealth = {
  records: 18432,
  linkedSessions: 86,
  unlinkedSessions: 4,
  sourceCoverage: 82,
};
