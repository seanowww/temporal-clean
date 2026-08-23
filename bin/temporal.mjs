#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import path from "node:path";

function usage() {
  console.log(`Temporal collector

Usage:
  temporal status [--endpoint http://localhost:3000]
  temporal collect claude --file <session.jsonl> [--repo owner/repo] [--branch name] [--actor name]
  temporal collect claude-mem [--project name] [--since 2026-08-01] [--limit 500]

Environment:
  TEMPORAL_ENDPOINT         API base URL (default http://localhost:3000)
  TEMPORAL_COLLECTOR_TOKEN  Bearer token when the server requires one
`);
}

function flags(args) {
  const result = {};
  for (let index = 0; index < args.length; index++) {
    if (!args[index].startsWith("--")) continue;
    const name = args[index].slice(2);
    const value = args[index + 1] && !args[index + 1].startsWith("--") ? args[++index] : true;
    result[name] = value;
  }
  return result;
}

function git(...args) {
  try { return execFileSync("git", args, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim(); }
  catch { return ""; }
}

function repositoryFromRemote(remote) {
  return remote
    .replace(/^git@github\.com:/, "")
    .replace(/^https?:\/\/github\.com\//, "")
    .replace(/\.git$/, "");
}

function textContent(content) {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return content == null ? "" : JSON.stringify(content);
  return content.map((part) => {
    if (typeof part === "string") return part;
    if (part?.type === "text") return part.text || "";
    if (part?.type === "tool_use") return `[tool ${part.name || "call"}] ${JSON.stringify(part.input || {})}`;
    if (part?.type === "tool_result") return `[tool result] ${textContent(part.content)}`;
    return JSON.stringify(part);
  }).filter(Boolean).join("\n");
}

function normalizeEntry(entry, index) {
  const rawRole = entry.role || entry.type || entry.message?.role;
  const role = rawRole === "assistant" ? "assistant" : rawRole === "tool" || rawRole === "tool_result" ? "tool" : "user";
  const content = textContent(entry.message?.content ?? entry.content ?? entry.text);
  if (!content.trim()) return null;
  return {
    id: entry.uuid || entry.id || undefined,
    role,
    content,
    timestamp: entry.timestamp || entry.created_at || undefined,
    position: index,
  };
}

async function readClaudeSession(file) {
  const raw = await readFile(file, "utf8");
  try {
    const parsed = JSON.parse(raw);
    const source = Array.isArray(parsed) ? parsed : parsed.messages;
    if (Array.isArray(source)) return { metadata: parsed, messages: source.map(normalizeEntry).filter(Boolean) };
  } catch {
    // Claude Code session exports commonly use JSONL.
  }
  const entries = raw.split(/\r?\n/).filter(Boolean).map((line, index) => {
    try { return JSON.parse(line); }
    catch { throw new Error(`Invalid JSONL on line ${index + 1}`); }
  });
  return { metadata: {}, messages: entries.map(normalizeEntry).filter(Boolean) };
}

async function request(endpoint, pathname, options = {}) {
  const headers = { "Content-Type": "application/json", ...(options.headers || {}) };
  if (process.env.TEMPORAL_COLLECTOR_TOKEN) headers.Authorization = `Bearer ${process.env.TEMPORAL_COLLECTOR_TOKEN}`;
  const response = await fetch(`${endpoint.replace(/\/$/, "")}${pathname}`, { ...options, headers });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || `Temporal returned ${response.status}`);
  return body;
}

async function main() {
  const args = process.argv.slice(2);
  const options = flags(args);
  const endpoint = String(options.endpoint || process.env.TEMPORAL_ENDPOINT || "http://localhost:3000");
  if (!args.length || args.includes("--help") || args[0] === "help") return usage();

  if (args[0] === "status") {
    const dashboard = await request(endpoint, "/api/dashboard");
    console.log(`${dashboard.workspace.name}: ${dashboard.graphHealth.records} records, ${dashboard.pullRequests.length} pull requests`);
    dashboard.connections.forEach((connection) => console.log(`- ${connection.name}: ${connection.status} (${connection.scope})`));
    return;
  }

  if (args[0] === "collect" && args[1] === "claude-mem") {
    const since = options.since ? Date.parse(String(options.since)) : undefined;
    if (options.since && !Number.isFinite(since)) throw new Error(`Could not parse --since ${options.since}`);
    const result = await request(endpoint, "/api/connections/claude-mem/sync", {
      method: "POST",
      body: JSON.stringify({
        project: options.project ? String(options.project) : undefined,
        since,
        limit: options.limit ? Number(options.limit) : undefined,
      }),
    });
    console.log(`Read ${result.observations} observations, ${result.summaries} summaries, ${result.prompts} prompts via ${result.transport}.`);
    console.log(`Wrote ${result.nodes} nodes and ${result.edges} edges; linked ${result.linkedPullRequests.length} pull request(s).`);
    if (result.unresolved) console.log(`${result.unresolved} record(s) have no repository or branch yet — install bin/temporal-hook.mjs or set TEMPORAL_CLAUDE_MEM_PROJECTS.`);
    return;
  }

  if (args[0] === "collect" && args[1] === "claude") {
    if (!options.file) throw new Error("--file is required");
    const file = path.resolve(String(options.file));
    const session = await readClaudeSession(file);
    const repository = String(options.repo || repositoryFromRemote(git("config", "--get", "remote.origin.url")));
    const branch = String(options.branch || git("branch", "--show-current"));
    const actor = String(options.actor || git("config", "user.email") || git("config", "user.name"));
    if (!repository || !branch || !actor) throw new Error("Could not infer repository, branch, or actor; pass --repo, --branch, and --actor");
    const startedAt = session.messages.find((message) => message.timestamp)?.timestamp || new Date().toISOString();
    const endedAt = [...session.messages].reverse().find((message) => message.timestamp)?.timestamp;
    const result = await request(endpoint, "/api/collect/claude", {
      method: "POST",
      body: JSON.stringify({
        sessionId: String(options.session || session.metadata.sessionId || session.metadata.session_id || path.basename(file).replace(/\.[^.]+$/, "")),
        repository,
        branch,
        actor,
        startedAt,
        endedAt,
        sourcePath: file,
        messages: session.messages.map(({ position: _position, ...message }) => message),
        commitShas: options.commit ? [String(options.commit)] : [],
      }),
    });
    console.log(`Collected ${session.messages.length} messages; linked ${result.linkedPullRequests.length} pull request(s); generated ${result.artifacts.length} artifact(s).`);
    return;
  }

  usage();
  throw new Error("Unknown command");
}

main().catch((error) => {
  console.error(`Temporal collector: ${error.message}`);
  process.exitCode = 1;
});
