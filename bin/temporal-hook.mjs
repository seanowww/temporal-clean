#!/usr/bin/env node

/**
 * Git-context ledger writer.
 *
 * claude-mem records memory against a `project` name and never stores a repository,
 * branch, or commit. Temporal links evidence by exactly those fields. This hook stamps the
 * git state of the working directory whenever a Claude Code session starts or touches a
 * file, so `lib/claude-mem/git-context.ts` can give every observation the branch it was
 * actually made on.
 *
 * Install (in ~/.claude/settings.json):
 *
 *   "hooks": {
 *     "SessionStart":  [{ "hooks": [{ "type": "command", "command": "node /abs/path/bin/temporal-hook.mjs" }] }],
 *     "PostToolUse":   [{ "matcher": "Edit|Write|Bash", "hooks": [{ "type": "command", "command": "node /abs/path/bin/temporal-hook.mjs" }] }]
 *   }
 *
 * Hooks receive JSON on stdin and must stay fast and silent; every failure path exits 0 so
 * a broken ledger never blocks a session.
 */

import { appendFileSync, mkdirSync, readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { homedir } from "node:os";
import path from "node:path";

const LEDGER = process.env.TEMPORAL_GIT_CONTEXT_PATH || path.join(homedir(), ".claude", "temporal", "git-context.jsonl");

function git(cwd, ...args) {
  try { return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim(); }
  catch { return ""; }
}

function repositoryFromRemote(remote) {
  return remote
    .replace(/^git@github\.com:/, "")
    .replace(/^https?:\/\/github\.com\//, "")
    .replace(/\.git$/, "");
}

function readStdin() {
  try { return JSON.parse(readFileSync(0, "utf8") || "{}"); }
  catch { return {}; }
}

function main() {
  const payload = readStdin();
  const cwd = payload.cwd || process.env.CLAUDE_PROJECT_DIR || process.cwd();
  const repository = repositoryFromRemote(git(cwd, "config", "--get", "remote.origin.url"));
  const branch = git(cwd, "branch", "--show-current");
  if (!repository || !branch) return;

  const entry = {
    sessionId: payload.session_id || payload.sessionId || undefined,
    project: path.basename(cwd),
    cwd,
    repository,
    branch,
    headSha: git(cwd, "rev-parse", "HEAD") || undefined,
    at: Date.now(),
  };

  mkdirSync(path.dirname(LEDGER), { recursive: true });
  appendFileSync(LEDGER, `${JSON.stringify(entry)}\n`);
}

try { main(); } catch { /* Never fail a session because provenance capture failed. */ }
process.exit(0);
