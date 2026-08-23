import { existsSync } from "node:fs";
import path from "node:path";
import { claudeMemDbPath, claudeMemHome } from "../claude-mem/client";
import { githubAppConfigured } from "../github-app";

export type ConnectorId = "github" | "slack" | "jira" | "notion" | "claude" | "claude-mem" | "codex";

export type ConnectorDefinition = {
  id: ConnectorId;
  name: string;
  description: string;
  auth: "oauth-token" | "file" | "local";
  env: string[];
  accent: string;
  accepts: string;
};

export const connectorCatalog: ConnectorDefinition[] = [
  { id: "github", name: "GitHub", description: "Pull requests, commits, reviews, and changed files", auth: "oauth-token", env: ["GITHUB_TOKEN"], accent: "#f2f0f7", accepts: ".json,.jsonl,.txt" },
  { id: "slack", name: "Slack", description: "Approved channel history and linked decision threads", auth: "oauth-token", env: ["SLACK_BOT_TOKEN"], accent: "#36c5f0", accepts: ".json,.jsonl,.txt" },
  { id: "jira", name: "Jira", description: "Issues, acceptance criteria, and project decisions", auth: "oauth-token", env: ["JIRA_BASE_URL", "JIRA_EMAIL", "JIRA_API_TOKEN"], accent: "#2684ff", accepts: ".json,.jsonl,.txt" },
  { id: "notion", name: "Notion", description: "Plans, requirements, and page revisions", auth: "oauth-token", env: ["NOTION_TOKEN"], accent: "#e9e6f7", accepts: ".json,.jsonl,.txt" },
  { id: "claude", name: "Claude Code", description: "Local sessions, decisions, and tool traces", auth: "file", env: [], accent: "#d97757", accepts: ".json,.jsonl,.txt,.md" },
  { id: "claude-mem", name: "claude-mem", description: "Compressed agent decisions, discoveries, and session summaries", auth: "local", env: [], accent: "#c56b45", accepts: ".json" },
  { id: "codex", name: "Codex", description: "Task transcripts, edits, and implementation decisions", auth: "file", env: [], accent: "#a87bff", accepts: ".json,.jsonl,.txt,.md" },
];

export function getConnector(id: string) {
  return connectorCatalog.find((connector) => connector.id === id) || null;
}

/** claude-mem is a local install, so presence of its data directory is the credential. */
export function claudeMemInstalled() {
  return existsSync(claudeMemDbPath()) || existsSync(path.join(claudeMemHome(), "settings.json"));
}

export function connectorRuntimeState(connector: ConnectorDefinition) {
  const appConfigured = connector.id === "github" && githubAppConfigured();
  const localConfigured = connector.auth === "local" && claudeMemInstalled();
  const legacyConfigured = connector.env.length > 0 && connector.env.every((name) => Boolean(process.env[name]));
  const configured = appConfigured || legacyConfigured || localConfigured;
  return {
    ...connector,
    configured,
    appConfigured,
    legacyConfigured,
    mode: connector.auth === "local"
      ? localConfigured ? "Local worker + export fallback" : "claude-mem not detected"
      : connector.auth === "file" ? "File / paste"
      : appConfigured ? "GitHub App + file fallback"
      : configured ? "API + file fallback" : "File / paste fallback",
  };
}
