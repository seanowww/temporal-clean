import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

process.env.TEMPORAL_DB_PATH = ":memory:";

const { toObservation, toSummary, toPrompt, toList, projectMatches, normalizePlatformSource } = await import("../lib/claude-mem/types");
const { loadLedger, resolveGitContext } = await import("../lib/claude-mem/git-context");
const { normalizeSnapshot, stripPrivate, observationImportance } = await import("../lib/claude-mem/normalize");
const { snapshotFromExport, readSnapshot, unwrapPage } = await import("../lib/claude-mem/client");
const { sharesFilePath, traverseGraph } = await import("../lib/graph");
const { ingestClaudeMemExport } = await import("../lib/ingest/claude-mem");
const { ingestGitHubWebhook } = await import("../lib/ingest/github");
const { assembleArtifact } = await import("../lib/artifact");
const { listGraphEdges, listGraphNodes } = await import("../lib/store");

test("observation rows survive claude-mem column renames and list encodings", () => {
  const modern = toObservation({
    id: 7,
    memory_session_id: "mem-1",
    project: "temporal",
    type: "decision",
    title: "Use job-level idempotency keys",
    narrative: "Shard-local cursors move during rebalance.",
    facts: JSON.stringify(["Cursors are not stable", "Retries duplicate rows"]),
    files_modified: JSON.stringify(["lib/exports/queue.ts"]),
    files_read: "lib/db.ts,lib/store.ts",
    created_at: "2026-08-20T10:00:00.000Z",
    created_at_epoch: 1_755_684_000_000,
  });
  assert.equal(modern.sessionId, "mem-1");
  assert.deepEqual(modern.facts, ["Cursors are not stable", "Retries duplicate rows"]);
  assert.deepEqual(modern.filesModified, ["lib/exports/queue.ts"]);
  assert.deepEqual(modern.filesRead, ["lib/db.ts", "lib/store.ts"]);

  // The documented schema still calls this sdk_session_id; both must resolve.
  const legacy = toObservation({ id: 8, sdk_session_id: "sdk-1", project: "temporal", type: "bugfix", created_at: "2026-08-20T10:00:00.000Z" });
  assert.equal(legacy.sessionId, "sdk-1");
  assert.equal(legacy.title, "Agent observation");

  assert.equal(toSummary({ id: 1, memory_session_id: "mem-1", project: "temporal", next_steps: JSON.stringify(["Verify retry path"]), created_at: "2026-08-20T10:00:00.000Z" }).nextSteps[0], "Verify retry path");
  assert.equal(toPrompt({ id: 1, content_session_id: "mem-1", prompt_text: "Why do retries duplicate rows?", created_at: "2026-08-20T10:00:00.000Z" }).sessionId, "mem-1");
  assert.deepEqual(toList("[]"), []);
  assert.deepEqual(toList(null), []);
  assert.ok(projectMatches("temporal/night-parsnip", "temporal"));
  assert.equal(projectMatches("temporal", "unrelated"), false);
});

test("private content never leaves the ingest boundary", () => {
  assert.equal(stripPrivate("keep <private>secret token</private> this"), "keep  this");
  const records = normalizeSnapshot({
    observations: [toObservation({
      id: 1, memory_session_id: "mem-1", project: "temporal", type: "decision",
      title: "Rotate keys <private>sk-live-abc</private>",
      narrative: "Public reasoning <private>internal note</private>",
      created_at: "2026-08-20T10:00:00.000Z",
    })],
    summaries: [],
    prompts: [],
  });
  const observation = records.find((record) => record.node.type === "agent_observation")!;
  assert.equal(observation.node.title.includes("sk-live-abc"), false);
  assert.equal(observation.node.content.includes("internal note"), false);
  assert.equal(String(observation.node.metadata?.excerpt).includes("internal note"), false);
});

test("observation type sets artifact importance and decisions outrank routine change", () => {
  assert.equal(observationImportance("decision"), 5);
  assert.equal(observationImportance("change"), 2);
  assert.ok(observationImportance("decision") > observationImportance("refactor"));
  assert.equal(observationImportance("unknown-type"), 2);
});

test("the git-context ledger gives claude-mem records a repository and branch", () => {
  const onMain = Date.parse("2026-08-19T08:00:00.000Z");
  const switched = Date.parse("2026-08-20T08:00:00.000Z");
  const otherBranch = Date.parse("2026-08-21T08:00:00.000Z");
  const ledger = loadLedger([
    JSON.stringify({ project: "temporal", repository: "acme/platform-api", branch: "main", headSha: "aaa", at: onMain }),
    JSON.stringify({ project: "temporal", repository: "acme/platform-api", branch: "feature/export", headSha: "abc123", at: switched }),
    JSON.stringify({ sessionId: "mem-9", project: "temporal", repository: "acme/platform-api", branch: "feature/other", at: otherBranch }),
    "{ truncated write",
  ].join("\n"));
  assert.equal(ledger.length, 3, "a truncated trailing write must not discard the ledger");

  // Work recorded after the branch switch inherits the branch in effect at that moment.
  const during = Date.parse("2026-08-20T10:00:00.000Z");
  const interval = resolveGitContext("temporal", during, ledger);
  assert.equal(interval.branch, "feature/export");
  assert.equal(interval.commitSha, "abc123");
  assert.equal(interval.confidence, "interval");

  // A session id is authoritative regardless of timing.
  assert.equal(resolveGitContext("temporal", during, ledger, "mem-9").confidence, "exact");
  assert.equal(resolveGitContext("temporal", during, ledger, "mem-9").branch, "feature/other");

  // Work before any ledger entry still resolves to the earliest known state.
  assert.equal(resolveGitContext("temporal", Date.parse("2026-08-01T00:00:00.000Z"), ledger).branch, "main");
  assert.equal(resolveGitContext("unknown-project", during, ledger).confidence, "none");

  // Hooks that write second-precision timestamps must still land in the right interval.
  const seconds = loadLedger(JSON.stringify({ project: "temporal", repository: "acme/platform-api", branch: "feature/export", at: Math.floor(switched / 1_000) }));
  assert.equal(resolveGitContext("temporal", during, seconds).branch, "feature/export");

  process.env.TEMPORAL_CLAUDE_MEM_PROJECTS = "docs=acme/docs";
  assert.equal(resolveGitContext("docs", 1, []).repository, "acme/docs");
  assert.equal(resolveGitContext("docs", 1, []).confidence, "mapped");
  delete process.env.TEMPORAL_CLAUDE_MEM_PROJECTS;
});

test("changed-file overlap links evidence that branch matching alone would miss", () => {
  assert.ok(sharesFilePath(["lib/exports/queue.ts"], ["lib/exports/queue.ts"]));
  assert.ok(sharesFilePath(["/Users/dev/repo/lib/exports/queue.ts"], ["lib/exports/queue.ts"]));
  assert.equal(sharesFilePath(["lib/other.ts"], ["lib/exports/queue.ts"]), false);
  assert.equal(sharesFilePath([], ["lib/exports/queue.ts"]), false);

  const node = {
    id: "obs-1", type: "agent_observation", source: "claude", sourceId: "claude-mem:obs:1",
    title: "Use job-level idempotency keys", content: "", occurredAt: "2026-08-20T10:00:00.000Z",
    acl: { policy: "workspace", allowedSubjects: [] },
    metadata: { filesModified: ["lib/exports/queue.ts"] },
  };
  const seed = {
    nodeId: "pr-node", repository: "acme/platform-api", branch: "feature/export",
    author: "aria", openedAt: "2026-08-21T20:00:00.000Z", ticketIds: [],
  };

  // Same evidence, no repository or branch on the node: only the file signal can carry it.
  const withoutFiles = traverseGraph(seed, [node], [], { minimumScore: 40 });
  const withFiles = traverseGraph({ ...seed, filePaths: ["lib/exports/queue.ts"] }, [node], [], { minimumScore: 40 });
  assert.equal(withoutFiles.length, 0);
  assert.equal(withFiles.length, 1);
  assert.ok(withFiles[0].reasons.includes("touched a file this PR changes"));
});

test("a claude-mem export becomes PR-linked artifact evidence", async () => {
  ingestGitHubWebhook("delivery-cm-1", "pull_request", {
    action: "opened",
    repository: { full_name: "acme/platform-api" },
    pull_request: {
      number: 101, title: "EXP-42 make exports retry-safe", body: "Implements EXP-42",
      state: "open", created_at: "2026-08-21T20:00:00.000Z", updated_at: "2026-08-21T20:00:00.000Z",
      user: { login: "aria" }, head: { ref: "feature/export", sha: "abc123" }, base: { ref: "main" },
    },
  });

  const ledger = loadLedger(JSON.stringify({
    project: "temporal", repository: "acme/platform-api", branch: "feature/export", headSha: "abc123",
    at: Date.parse("2026-08-20T09:00:00.000Z"),
  }));

  const exported = JSON.stringify({
    observations: [
      { id: 1, memory_session_id: "mem-1", project: "temporal", type: "decision", title: "Use job-level idempotency keys", narrative: "Shard-local cursors move during rebalance, so per-shard keys duplicate rows.", files_modified: JSON.stringify(["lib/exports/queue.ts"]), created_at: "2026-08-20T10:00:00.000Z", created_at_epoch: Date.parse("2026-08-20T10:00:00.000Z") },
      { id: 2, memory_session_id: "mem-1", project: "temporal", type: "change", title: "Reformat imports", created_at: "2026-08-20T10:05:00.000Z", created_at_epoch: Date.parse("2026-08-20T10:05:00.000Z") },
    ],
    summaries: [
      { id: 1, memory_session_id: "mem-1", project: "temporal", request: "Make bulk exports retry-safe", learned: "Retries duplicated rows because cursors are shard-local.", next_steps: JSON.stringify(["Verify a mid-rebalance retry emits no duplicates"]), created_at: "2026-08-20T10:10:00.000Z", created_at_epoch: Date.parse("2026-08-20T10:10:00.000Z") },
    ],
    prompts: [
      { id: 1, content_session_id: "mem-1", project: "temporal", prompt_text: "Why do retries duplicate rows for EXP-42?", created_at: "2026-08-20T09:59:00.000Z", created_at_epoch: Date.parse("2026-08-20T09:59:00.000Z") },
    ],
  });

  const result = ingestClaudeMemExport(exported, { ledger, actor: "aria" });
  assert.equal(result.observations, 2);
  assert.equal(result.sessions, 1);
  assert.equal(result.unresolved, 0);
  assert.deepEqual(result.linkedPullRequests, ["pr-101"]);

  const nodes = listGraphNodes();
  const decision = nodes.find((node) => node.sourceId === "claude-mem:obs:1")!;
  assert.equal(decision.source, "claude", "nodes stay on the claude source so existing linkage keeps working");
  assert.equal(decision.metadata.provider, "claude-mem", "provider attributes the record to its own connector tile");
  assert.equal(decision.branch, "feature/export");
  assert.equal(decision.metadata.imp, 5);
  assert.ok(listGraphEdges().some((edge) => edge.type === "CONTAINS"));

  const artifact = await assembleArtifact("pr-101", { useAi: false, filePaths: ["lib/exports/queue.ts"] });
  const events = artifact.events.map((event) => String(event.evidenceId));
  assert.ok(events.includes("claude-mem:obs:1"), "the decision reaches the artifact");
  assert.ok(events.includes("claude-mem:summary:1"), "the session summary reaches the artifact");
  assert.equal(events.includes("claude-mem:prompt:1"), false, "raw prompts stay graph-only context");

  const decisionEvent = artifact.events.find((event) => event.evidenceId === "claude-mem:obs:1")!;
  assert.equal(decisionEvent.imp, 5);
  assert.ok(String(decisionEvent.excerpt).includes("Shard-local cursors"));
  const summaryEvent = artifact.events.find((event) => event.evidenceId === "claude-mem:summary:1")!;
  assert.deepEqual(summaryEvent.tests, ["Verify a mid-rebalance retry emits no duplicates"]);
});

test("worker list responses are read through both envelope shapes", () => {
  // Verified against claude-mem 13.15.3, which returns `items`; the docs still say `observations`.
  assert.equal(unwrapPage({ items: [{ id: 1 }], hasMore: false }, "observations")?.length, 1);
  assert.equal(unwrapPage({ observations: [{ id: 1 }] }, "observations")?.length, 1);
  assert.equal(unwrapPage({ prompts: [{ id: 1 }] }, "prompts")?.length, 1);
  assert.equal(unwrapPage({ total: 0 }, "observations"), null);
});

test("prompts inherit project and session identity from sdk_sessions", async () => {
  // user_prompts stores neither project nor memory_session_id, so an unjoined read would
  // strand every prompt in a duplicate session with no repository.
  const file = path.join(mkdtempSync(path.join(tmpdir(), "claude-mem-")), "claude-mem.db");
  const db = new DatabaseSync(file);
  db.exec(`
    CREATE TABLE observations (id INTEGER PRIMARY KEY, memory_session_id TEXT, project TEXT, type TEXT, title TEXT, narrative TEXT, facts TEXT, concepts TEXT, files_read TEXT, files_modified TEXT, prompt_number INTEGER, created_at TEXT, created_at_epoch INTEGER);
    CREATE TABLE session_summaries (id INTEGER PRIMARY KEY, memory_session_id TEXT, project TEXT, request TEXT, learned TEXT, next_steps TEXT, created_at TEXT, created_at_epoch INTEGER);
    CREATE TABLE user_prompts (id INTEGER PRIMARY KEY, session_db_id INTEGER, content_session_id TEXT, prompt_number INTEGER, prompt_text TEXT, created_at TEXT, created_at_epoch INTEGER);
    CREATE TABLE sdk_sessions (id INTEGER PRIMARY KEY, content_session_id TEXT, memory_session_id TEXT, project TEXT, platform_source TEXT, status TEXT);
  `);
  const at = Date.parse("2026-08-20T10:00:00.000Z");
  db.prepare(`INSERT INTO sdk_sessions (content_session_id, memory_session_id, project, platform_source, status) VALUES (?, ?, ?, ?, ?)`).run("content-1", "mem-1", "temporal", "claude", "completed");
  db.prepare(`INSERT INTO observations (memory_session_id, project, type, title, created_at, created_at_epoch) VALUES (?, ?, ?, ?, ?, ?)`).run("mem-1", "temporal", "decision", "Use idempotency keys", "2026-08-20T10:00:00.000Z", at);
  db.prepare(`INSERT INTO user_prompts (content_session_id, prompt_number, prompt_text, created_at, created_at_epoch) VALUES (?, ?, ?, ?, ?)`).run("content-1", 1, "Why do retries duplicate rows?", "2026-08-20T09:59:00.000Z", at - 60_000);
  db.close();

  const previous = { transport: process.env.CLAUDE_MEM_TRANSPORT, dbPath: process.env.CLAUDE_MEM_DB_PATH };
  process.env.CLAUDE_MEM_TRANSPORT = "sqlite";
  process.env.CLAUDE_MEM_DB_PATH = file;
  try {
    const snapshot = await readSnapshot({});
    assert.equal(snapshot.transport, "sqlite");
    assert.equal(snapshot.prompts[0].project, "temporal");
    assert.equal(snapshot.prompts[0].sessionId, snapshot.observations[0].sessionId, "prompt and observation share one session");

    // One session node, not two.
    const records = normalizeSnapshot(snapshot, { ledger: [] });
    assert.equal(records.filter((record) => record.node.type === "agent_session").length, 1);
  } finally {
    if (previous.transport === undefined) delete process.env.CLAUDE_MEM_TRANSPORT; else process.env.CLAUDE_MEM_TRANSPORT = previous.transport;
    if (previous.dbPath === undefined) delete process.env.CLAUDE_MEM_DB_PATH; else process.env.CLAUDE_MEM_DB_PATH = previous.dbPath;
  }
});

test("platform_source is sanitized the same way claude-mem sanitizes it", () => {
  // claude-mem's own normalizer (src/shared/platform-source.ts) folds any raw IDE identifier
  // ("codex-cli", "vscode-copilot-cli", raw "transcript") into a short canonical set. Matching
  // that here is what lets Temporal trust a value read straight off an older or hand-built row.
  assert.equal(normalizePlatformSource("codex"), "codex");
  assert.equal(normalizePlatformSource("codex-cli"), "codex");
  assert.equal(normalizePlatformSource("transcript"), "codex");
  assert.equal(normalizePlatformSource("Claude Code"), "claude");
  assert.equal(normalizePlatformSource("cursor"), "cursor");
  assert.equal(normalizePlatformSource("windsurf"), "windsurf");
  assert.equal(normalizePlatformSource(undefined), undefined);
  assert.equal(normalizePlatformSource(""), undefined);
});

test("claude-mem observations from other agents get their own source instead of Claude Code's", () => {
  // claude-mem installs into any agent it supports (Codex, Cursor, ...), not just Claude Code.
  // Codex already has a dedicated logo, accent color, and traversal styling in Temporal, so a
  // Codex-authored decision should read as Codex evidence, not get folded into Claude Code's.
  const exported = JSON.stringify({
    observations: [
      { id: 101, memory_session_id: "codex-session", project: "temporal", type: "decision", title: "Switch to streamed diffs", platform_source: "codex-cli", created_at: "2026-08-20T10:00:00.000Z", created_at_epoch: Date.parse("2026-08-20T10:00:00.000Z") },
      { id: 102, memory_session_id: "claude-session", project: "temporal", type: "decision", title: "Add idempotency keys", platform_source: "claude", created_at: "2026-08-20T10:01:00.000Z", created_at_epoch: Date.parse("2026-08-20T10:01:00.000Z") },
      { id: 103, memory_session_id: "cursor-session", project: "temporal", type: "decision", title: "Inline the validator", platform_source: "cursor", created_at: "2026-08-20T10:02:00.000Z", created_at_epoch: Date.parse("2026-08-20T10:02:00.000Z") },
    ],
  });
  const snapshot = snapshotFromExport(JSON.parse(exported));
  assert.equal(snapshot.observations[0].platformSource, "codex");
  assert.equal(snapshot.observations[1].platformSource, "claude");
  assert.equal(snapshot.observations[2].platformSource, "cursor");

  const records = normalizeSnapshot(snapshot, { ledger: [] });
  const bySourceId = new Map(records.map((record) => [record.node.sourceId, record.node]));

  const codex = bySourceId.get("claude-mem:obs:101")!;
  assert.equal(codex.source, "codex", "Codex evidence gets Temporal's dedicated codex source");
  assert.equal(codex.metadata!.platform, "codex");

  const claude = bySourceId.get("claude-mem:obs:102")!;
  assert.equal(claude.source, "claude");
  assert.equal(claude.metadata!.platform, "claude");

  // Cursor has no dedicated source/logo yet — it degrades to the claude bucket rather than a
  // broken CSS class, but the real platform is never lost.
  const cursor = bySourceId.get("claude-mem:obs:103")!;
  assert.equal(cursor.source, "claude");
  assert.equal(cursor.metadata!.platform, "cursor");

  const codexSession = bySourceId.get("claude-mem:session:codex-session")!;
  assert.equal(codexSession.source, "codex");
  assert.ok(String(codexSession.title).startsWith("Codex session"));
});

test("the SQLite fallback joins platform_source from sdk_sessions for observations and summaries", async () => {
  const file = path.join(mkdtempSync(path.join(tmpdir(), "claude-mem-")), "claude-mem.db");
  const db = new DatabaseSync(file);
  db.exec(`
    CREATE TABLE observations (id INTEGER PRIMARY KEY, memory_session_id TEXT, project TEXT, type TEXT, title TEXT, narrative TEXT, facts TEXT, concepts TEXT, files_read TEXT, files_modified TEXT, prompt_number INTEGER, created_at TEXT, created_at_epoch INTEGER);
    CREATE TABLE session_summaries (id INTEGER PRIMARY KEY, memory_session_id TEXT, project TEXT, request TEXT, learned TEXT, next_steps TEXT, created_at TEXT, created_at_epoch INTEGER);
    CREATE TABLE user_prompts (id INTEGER PRIMARY KEY, session_db_id INTEGER, content_session_id TEXT, prompt_number INTEGER, prompt_text TEXT, created_at TEXT, created_at_epoch INTEGER);
    CREATE TABLE sdk_sessions (id INTEGER PRIMARY KEY, content_session_id TEXT, memory_session_id TEXT, project TEXT, platform_source TEXT, status TEXT);
  `);
  const at = Date.parse("2026-08-20T10:00:00.000Z");
  db.prepare(`INSERT INTO sdk_sessions (content_session_id, memory_session_id, project, platform_source, status) VALUES (?, ?, ?, ?, ?)`).run("content-claude", "mem-claude", "temporal", "claude", "completed");
  db.prepare(`INSERT INTO sdk_sessions (content_session_id, memory_session_id, project, platform_source, status) VALUES (?, ?, ?, ?, ?)`).run("content-codex", "mem-codex", "temporal", "codex", "completed");
  db.prepare(`INSERT INTO observations (memory_session_id, project, type, title, created_at, created_at_epoch) VALUES (?, ?, ?, ?, ?, ?)`).run("mem-claude", "temporal", "decision", "Use idempotency keys", "2026-08-20T10:00:00.000Z", at);
  db.prepare(`INSERT INTO observations (memory_session_id, project, type, title, created_at, created_at_epoch) VALUES (?, ?, ?, ?, ?, ?)`).run("mem-codex", "temporal", "decision", "Stream the diff instead of buffering it", "2026-08-20T10:01:00.000Z", at + 60_000);
  db.close();

  const previous = { transport: process.env.CLAUDE_MEM_TRANSPORT, dbPath: process.env.CLAUDE_MEM_DB_PATH };
  process.env.CLAUDE_MEM_TRANSPORT = "sqlite";
  process.env.CLAUDE_MEM_DB_PATH = file;
  try {
    const snapshot = await readSnapshot({});
    const byTitle = new Map(snapshot.observations.map((observation) => [observation.title, observation.platformSource]));
    assert.equal(byTitle.get("Use idempotency keys"), "claude");
    assert.equal(byTitle.get("Stream the diff instead of buffering it"), "codex");
  } finally {
    if (previous.transport === undefined) delete process.env.CLAUDE_MEM_TRANSPORT; else process.env.CLAUDE_MEM_TRANSPORT = previous.transport;
    if (previous.dbPath === undefined) delete process.env.CLAUDE_MEM_DB_PATH; else process.env.CLAUDE_MEM_DB_PATH = previous.dbPath;
  }
});

test("routine agent chatter stays off the timeline while decisions reach it", async () => {
  ingestGitHubWebhook("delivery-signal", "pull_request", {
    action: "opened",
    repository: { full_name: "acme/signal-api" },
    pull_request: {
      number: 7, title: "Make exports retry-safe", body: "",
      state: "open", created_at: "2026-08-22T20:00:00.000Z", updated_at: "2026-08-22T20:00:00.000Z",
      user: { login: "aria" }, head: { ref: "feature/signal", sha: "sig123" }, base: { ref: "main" },
    },
  });

  const ledger = loadLedger(JSON.stringify({
    sessionId: "mem-signal", project: "signal", repository: "acme/signal-api",
    branch: "feature/signal", headSha: "sig123", at: Date.parse("2026-08-22T09:00:00.000Z"),
  }));

  // Both records share the branch, the commit, and a changed file, so traversal score
  // cannot separate them — only importance can.
  const touched = JSON.stringify(["lib/exports/queue.ts"]);
  ingestClaudeMemExport(JSON.stringify({
    observations: [
      { id: 91, memory_session_id: "mem-signal", project: "signal", type: "decision", title: "Reject the distributed lock", narrative: "It serialises every export.", files_modified: touched, created_at: "2026-08-22T10:00:00.000Z", created_at_epoch: Date.parse("2026-08-22T10:00:00.000Z") },
      { id: 92, memory_session_id: "mem-signal", project: "signal", type: "change", title: "Reformat import ordering", narrative: "Applied the lint rule.", files_modified: touched, created_at: "2026-08-22T10:05:00.000Z", created_at_epoch: Date.parse("2026-08-22T10:05:00.000Z") },
    ],
    summaries: [], prompts: [],
  }), { ledger, actor: "aria" });

  const artifact = await assembleArtifact("pr-7", { useAi: false, filePaths: ["lib/exports/queue.ts"] });
  const evidence = artifact.events.map((event) => String(event.evidenceId));
  assert.ok(evidence.includes("claude-mem:obs:91"), "the decision reaches the timeline");
  assert.equal(evidence.includes("claude-mem:obs:92"), false, "the lint-only change does not");

  // The empty session container must not render, and must not seed a QA focus point.
  assert.equal(evidence.some((id) => id.startsWith("claude-mem:session:")), false, "session containers stay off the timeline");
  const qa = artifact.events.flatMap((event) => (Array.isArray(event.tests) ? event.tests as string[] : []));
  assert.equal(qa.some((point) => point.includes("agent-session")), false, "no placeholder QA step for a contentless node");

  // Low signal is a rendering decision, not a traversal one: an explicit pick still wins.
  const both = await assembleArtifact("pr-7", {
    useAi: false,
    filePaths: ["lib/exports/queue.ts"],
    selectedNodeIds: listGraphNodes().filter((node) => node.sourceId.startsWith("claude-mem:obs:")).map((node) => node.id),
  });
  assert.ok(both.events.map((event) => String(event.evidenceId)).includes("claude-mem:obs:92"), "explicit selection overrides the importance floor");
});

test("a raw transcript session still renders, since the transcript is its only form", async () => {
  const { ingestClaudeSession } = await import("../lib/ingest/claude");
  ingestGitHubWebhook("delivery-raw", "pull_request", {
    action: "opened",
    repository: { full_name: "acme/raw-api" },
    pull_request: {
      number: 8, title: "Raw transcript path", body: "",
      state: "open", created_at: "2026-08-22T20:00:00.000Z", updated_at: "2026-08-22T20:00:00.000Z",
      user: { login: "aria" }, head: { ref: "feature/raw", sha: "raw123" }, base: { ref: "main" },
    },
  });
  ingestClaudeSession({
    sessionId: "raw-session-8", repository: "acme/raw-api", branch: "feature/raw", actor: "aria",
    startedAt: "2026-08-22T10:00:00.000Z",
    messages: [
      { role: "user", content: "Why does the export duplicate rows?" },
      { role: "assistant", content: "Shard-local cursors replay after a rebalance." },
    ],
    commitShas: ["raw123"],
  });

  const artifact = await assembleArtifact("pr-8", { useAi: false, filePaths: [] });
  assert.ok(artifact.events.some((event) => event.src === "claude"), "the raw session is still the only evidence it has");
});

test("exports without recognisable claude-mem records are rejected", () => {
  assert.throws(() => ingestClaudeMemExport("not json"), /must be JSON/);
  assert.throws(() => ingestClaudeMemExport(JSON.stringify({ messages: [] })), /No claude-mem observations/);
  assert.deepEqual(snapshotFromExport({ session_summaries: [] }).summaries, []);
});
