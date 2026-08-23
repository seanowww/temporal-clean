import type { ConnectorId } from "./catalog";
import type { GraphNodeInput } from "../store";

export type ParseContext = {
  repository?: string;
  branch?: string;
  importedAt?: string;
  filename?: string;
  connectionId?: string;
  syncRunId?: string;
};

export type ParsedConnectorRecord = GraphNodeInput & { parentSourceId?: string };

const iso = (value: unknown, fallback: string) => {
  if (typeof value === "number") return new Date(value < 1e12 ? value * 1_000 : value).toISOString();
  if (typeof value === "string") {
    const slack = /^\d{10,}(?:\.\d+)?$/.test(value) ? Number(value) * 1_000 : NaN;
    const parsed = Number.isFinite(slack) ? slack : Date.parse(value);
    if (Number.isFinite(parsed)) return new Date(parsed).toISOString();
  }
  return fallback;
};

const text = (value: unknown): string => {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.map(text).filter(Boolean).join("\n");
  if (value && typeof value === "object") {
    const object = value as Record<string, unknown>;
    return text(object.plain_text ?? object.text ?? object.content ?? object.value ?? object.description ?? "");
  }
  return value == null ? "" : String(value);
};

function parseInput(content: string): unknown {
  const trimmed = content.trim();
  if (!trimmed) return [];
  try { return JSON.parse(trimmed); } catch {
    const lines = trimmed.split(/\r?\n/).filter(Boolean);
    const parsed: unknown[] = [];
    for (const line of lines) {
      try { parsed.push(JSON.parse(line)); } catch { parsed.push({ text: line }); }
    }
    return parsed;
  }
}

function arrayFrom(value: unknown, keys: string[]) {
  if (Array.isArray(value)) return value;
  if (!value || typeof value !== "object") return [value];
  const object = value as Record<string, unknown>;
  for (const key of keys) if (Array.isArray(object[key])) return object[key] as unknown[];
  return [value];
}

function asObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? value as Record<string, unknown> : { text: value };
}

/**
 * A readable label. Prefers whole sentences, but keeps absorbing them while the label
 * is still short — otherwise a message opening with "Agreed." becomes an event titled
 * "Agreed.", which says nothing about what happened.
 */
export function headline(value: string, limit = 88) {
  const sentences = value.trim().split(/(?<=[.!?])\s+|\n+/).map((part) => part.trim()).filter(Boolean);
  if (!sentences.length) return "";
  let label = sentences[0];
  for (let index = 1; index < sentences.length && label.length < limit * .45; index++) {
    label = `${label} ${sentences[index]}`;
  }
  if (label.length <= limit) return label;
  const cut = label.slice(0, limit);
  const boundary = cut.lastIndexOf(" ");
  return `${(boundary > limit * .6 ? cut.slice(0, boundary) : cut).trimEnd()}…`;
}

function base(source: ConnectorId, sourceId: string, title: string, content: string, occurredAt: string, context: ParseContext): ParsedConnectorRecord {
  return {
    type: source === "github" ? "github_record" : source === "notion" ? "document" : source === "jira" ? "issue" : source === "slack" ? "message" : "agent_message",
    source,
    sourceId,
    title: title || `${source} record`,
    content,
    occurredAt,
    repository: context.repository,
    branch: context.branch,
    metadata: { importedFrom: context.filename || "paste", importedAt: context.importedAt || occurredAt, connectionId: context.connectionId, syncRunId: context.syncRunId },
  };
}

function parseSlack(data: unknown, context: ParseContext, fallback: string) {
  const records: ParsedConnectorRecord[] = [];
  const channels = arrayFrom(data, ["channels"]);
  for (const channelValue of channels) {
    const channel = asObject(channelValue);
    const messages = arrayFrom(channel.messages ?? channelValue, ["messages"]);
    for (const [index, messageValue] of messages.entries()) {
      const message = asObject(messageValue);
      const id = String(message.client_msg_id ?? message.ts ?? `message-${index}`);
      const content = text(message.text ?? message.content);
      const parent = String(message.thread_ts ?? "");
      records.push({
        ...base("slack", id, headline(content) || "Slack message", content, iso(message.ts ?? message.timestamp, fallback), context),
        actorId: text(message.user ?? message.username),
        sourceUrl: text(message.permalink),
        parentSourceId: parent && parent !== id ? parent : undefined,
        metadata: { channel: text(channel.name ?? channel.id ?? message.channel_name ?? message.channel), threadTs: parent || undefined },
      });
    }
  }
  return records;
}

function parseJira(data: unknown, context: ParseContext, fallback: string) {
  return arrayFrom(data, ["issues", "values"]).map((value, index) => {
    const issue = asObject(value); const fields = asObject(issue.fields);
    const key = text(issue.key ?? issue.id ?? `issue-${index}`);
    const summary = text(fields.summary ?? issue.summary ?? key);
    return {
      ...base("jira", key, `${key}: ${summary}`, [summary, text(fields.description ?? issue.description)].filter(Boolean).join("\n\n"), iso(fields.updated ?? fields.created ?? issue.updated, fallback), context),
      actorId: text(asObject(fields.assignee).displayName ?? asObject(fields.creator).displayName),
      sourceUrl: text(issue.self),
      metadata: { ticketId: key, status: text(asObject(fields.status).name), labels: fields.labels || [] },
    } satisfies ParsedConnectorRecord;
  });
}

function parseNotion(data: unknown, context: ParseContext, fallback: string) {
  return arrayFrom(data, ["results", "pages"]).map((value, index) => {
    const page = asObject(value); const props = asObject(page.properties);
    const titleProp = Object.values(props).find((prop) => asObject(prop).type === "title");
    const title = text(asObject(titleProp).title) || text(page.title) || `Notion page ${index + 1}`;
    const content = text(page.content ?? page.markdown ?? page.children ?? props);
    return { ...base("notion", text(page.id) || `page-${index}`, title, content || title, iso(page.last_edited_time ?? page.created_time, fallback), context), sourceUrl: text(page.url), metadata: { archived: Boolean(page.archived), properties: props } } satisfies ParsedConnectorRecord;
  });
}

function parseGithub(data: unknown, context: ParseContext, fallback: string) {
  return arrayFrom(data, ["pull_requests", "pullRequests", "commits", "reviews", "items"]).map((value, index) => {
    const item = asObject(value);
    const repository = context.repository || text(asObject(item.repository).full_name ?? item.repository_full_name);
    const sha = text(item.sha); const number = text(item.number); const id = repository && number ? `${repository}#${number}` : text(item.id ?? item.node_id ?? sha ?? number) || `record-${index}`;
    const title = text(item.title ?? asObject(item.commit).message ?? item.message ?? item.body).split("\n")[0] || `GitHub record ${id}`;
    return {
      ...base("github", id, title, text(item.body ?? asObject(item.commit).message ?? item.message ?? title), iso(item.updated_at ?? item.created_at ?? asObject(item.commit).author, fallback), context),
      type: sha ? "commit" : number ? "pull_request" : "github_record",
      actorId: text(asObject(item.user).login ?? asObject(item.author).login ?? asObject(asObject(item.commit).author).name),
      repository: repository || undefined,
      branch: context.branch || text(asObject(item.head).ref) || undefined,
      commitSha: sha || undefined,
      sourceUrl: text(item.html_url ?? item.url),
      metadata: { number: number || undefined },
    } satisfies ParsedConnectorRecord;
  });
}

/**
 * A chat export is a transcript, not a list of events. Emitting one node per turn
 * floods the timeline with "user: ..." / "assistant: ..." fragments, so the session
 * becomes the timeline event and the individual turns become supporting detail
 * typed `message` / `tool_call`, which artifact assembly already filters out.
 */
/**
 * Claude Code and Codex write JSONL where most lines are not conversation at all —
 * session bookkeeping, queue operations, attachments. Keeping every line produced 780
 * nodes for one session, 641 of them empty. Only entries that carry real text become
 * turns, matching what `bin/temporal.mjs` already does for the CLI path.
 */
const nonConversationalTypes = new Set([
  "bridge-session", "queue-operation", "attachment", "summary", "system",
  "file-history-snapshot", "progress", "diagnostic",
]);

function parseChat(source: "claude" | "codex", data: unknown, context: ParseContext, fallback: string) {
  const root = asObject(data);
  const sessionId = text(root.sessionId ?? root.session_id ?? root.id) || `${context.filename || source}-session`;
  const entries = arrayFrom(root.messages ?? root.items ?? data, ["messages", "items"]).map(asObject);

  const turns = entries
    .map((entry) => {
      const kind = text(entry.type);
      if (nonConversationalTypes.has(kind)) return null;
      const inner = asObject(entry.message);
      const role = text(entry.role ?? inner.role ?? entry.type) || "message";
      const content = text(entry.content ?? entry.text ?? inner.content ?? entry.prompt).trim();
      if (!content) return null;
      return {
        role,
        content,
        at: iso(entry.timestamp ?? entry.created_at ?? root.startedAt, fallback),
        id: text(entry.uuid ?? entry.id),
      };
    })
    .filter((turn): turn is NonNullable<typeof turn> => turn !== null);

  if (!turns.length) return [];

  const prompt = turns.find((entry) => entry.role === "user")?.content || turns[0].content;
  const transcript = turns.map((entry) => `${entry.role}: ${entry.content}`).join("\n\n");

  /*
   * The session is the timeline event; the turns are supporting detail typed
   * `message` / `tool_call`, which artifact assembly filters out. One transcript is
   * one thing that happened, not forty.
   */
  const session: ParsedConnectorRecord = {
    ...base(source, sessionId, headline(prompt) || `${source} session`, transcript, turns[0].at, context),
    type: "agent_session",
    actorId: text(root.actor) || source,
    metadata: { sessionId, messageCount: turns.length, endedAt: turns[turns.length - 1].at },
  };

  const children = turns.map((turn, index): ParsedConnectorRecord => ({
    ...base(source, turn.id || `${sessionId}:${index}`, `${turn.role} message`, turn.content, turn.at, context),
    type: turn.role === "tool" ? "tool_call" : "message",
    actorId: turn.role,
    parentSourceId: sessionId,
    metadata: { role: turn.role, sessionId, position: index },
  }));

  return [session, ...children];
}

/**
 * Per-source parsers build their own metadata, which would otherwise drop the import
 * provenance `base()` attaches. Import provenance is re-applied here so it survives
 * every source, and so the connection-history view has something to group by.
 */
function withImportProvenance(records: ParsedConnectorRecord[], context: ParseContext, fallback: string) {
  const importedFrom = context.filename || "paste";
  const importedAt = context.importedAt || fallback;
  return records.map((record) => ({ ...record, metadata: { importedFrom, importedAt, connectionId: context.connectionId, syncRunId: context.syncRunId, ...record.metadata } }));
}

export function parseConnectorDump(source: ConnectorId, content: string, context: ParseContext = {}) {
  const data = parseInput(content);
  const fallback = context.importedAt || new Date().toISOString();
  const records = source === "slack" ? parseSlack(data, context, fallback)
    : source === "jira" ? parseJira(data, context, fallback)
    : source === "notion" ? parseNotion(data, context, fallback)
    : source === "github" ? parseGithub(data, context, fallback)
    // claude-mem exports are ingested by lib/ingest/claude-mem.ts; a stray dump here degrades to chat parsing.
    : parseChat(source === "codex" ? "codex" : "claude", data, context, fallback);
  return withImportProvenance(records, context, fallback);
}
