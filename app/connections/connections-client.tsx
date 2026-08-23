"use client";

import { useRef, useState, type CSSProperties, type DragEvent } from "react";
import SourceLogo from "@/app/source-logo";

type ConnectionActivity = { id: string; label: string; detail: string; timestamp?: string; records: number; kind: "connection" | "import" };
type Connector = {
  id: string; name: string; description: string; configured: boolean; mode: string;
  source?: string;
  authType?: string;
  transport?: string;
  env?: string[];
  accepts: string; accent: string; status: string; scope: string; lastSync?: string; history: ConnectionActivity[];
  appConfigured: boolean; legacyConfigured: boolean; metadata?: Record<string, unknown>;
  configuration?: Record<string, unknown>;
};
type UploadItem = { id: string; file: File; status: "queued" | "importing" | "error"; message?: string };
type ImportResponse = { error?: string; records?: number; edges?: number };
type McpResponse = { error?: string; id?: string; authorizationRequired?: boolean; authorizationUrl?: string; capabilities?: { tools: unknown[]; resources: unknown[] }; assessment?: { compatible: boolean; missing: string[] } };

function formatBytes(bytes: number) {
  if (bytes < 1_000) return `${bytes} B`;
  if (bytes < 1_000_000) return `${(bytes / 1_000).toFixed(1)} KB`;
  return `${(bytes / 1_000_000).toFixed(1)} MB`;
}

function formatTimestamp(value?: string) {
  if (!value) return "Previously connected";
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) return value;
  return date.toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: "UTC", timeZoneName: "short" });
}

const githubNotices: Record<string, { kind: "ok" | "error" | "pending"; message: string }> = {
  connected: { kind: "ok", message: "GitHub App connected. Repository access is ready." },
  requested: { kind: "pending", message: "Installation requested. An organization owner must approve it." },
  setup_required: { kind: "error", message: "Configure the GitHub App environment values, then try again." },
  invalid_state: { kind: "error", message: "This connection attempt expired. Start the GitHub connection again." },
  missing_installation: { kind: "error", message: "GitHub did not return an installation. Try installing the app again." },
  api_error: { kind: "error", message: "GitHub installed the app, but repository access could not be verified. Check the app credentials." },
  manifest_invalid_state: { kind: "error", message: "GitHub App creation expired. Start the setup again." },
  manifest_failed: { kind: "error", message: "GitHub App creation did not finish. Check the server log and try again." },
  manifest_local_only: { kind: "error", message: "One-click credential storage is local-development only. Configure production secrets through your host." },
};

function ConnectorTile({ connector, notice }: { connector: Connector; notice?: string }) {
  const [open, setOpen] = useState(Boolean(notice));
  const [content, setContent] = useState("");
  const [repository, setRepository] = useState("");
  const [branch, setBranch] = useState("");
  const savedArguments = connector.configuration?.arguments && typeof connector.configuration.arguments === "object" ? connector.configuration.arguments as Record<string, unknown> : {};
  const [mcpQuery, setMcpQuery] = useState(typeof savedArguments.query === "string" ? savedArguments.query : "");
  const [uploads, setUploads] = useState<UploadItem[]>([]);
  const [dragging, setDragging] = useState(false);
  const [history, setHistory] = useState(connector.history);
  const [state, setState] = useState<{ kind: "idle" | "busy" | "ok" | "error"; message?: string }>({ kind: "idle" });
  const fileRef = useRef<HTMLInputElement>(null);
  const isLocal = connector.id === "claude-mem";

  function queueFiles(files: FileList | File[]) {
    const additions = Array.from(files).map((file, index) => ({ id: `${file.name}:${file.lastModified}:${file.size}:${Date.now() + index}`, file, status: "queued" as const }));
    if (!additions.length) return;
    setUploads((current) => [...current, ...additions]);
    setState({ kind: "idle" });
    if (fileRef.current) fileRef.current.value = "";
  }

  function onDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault(); setDragging(false); queueFiles(event.dataTransfer.files);
  }

  async function sendImport(filename: string, dump: string) {
    const response = await fetch(`/api/connections/${connector.id}/import`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ content: dump, filename, repository, branch }) });
    const result = await response.json() as ImportResponse;
    if (!response.ok) throw new Error(result.error || "Import failed");
    return result;
  }

  async function importDump() {
    const hasPaste = Boolean(content.trim());
    if (!uploads.length && !hasPaste) return setState({ kind: "error", message: "Choose one or more files, or paste an export first." });
    const total = uploads.length + (hasPaste ? 1 : 0);
    setState({ kind: "busy", message: `Importing ${total} ${total === 1 ? "source" : "sources"}…` });
    setUploads((current) => current.map((item) => ({ ...item, status: "importing", message: undefined })));

    const fileJobs = uploads.map(async (item) => {
      try {
        const result = await sendImport(item.file.name, await item.file.text());
        return { ok: true as const, id: item.id, filename: item.file.name, result };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        setUploads((current) => current.map((upload) => upload.id === item.id ? { ...upload, status: "error", message } : upload));
        return { ok: false as const, id: item.id, filename: item.file.name, message };
      }
    });
    const pasteJob = hasPaste ? sendImport("Pasted export", content).then((result) => ({ ok: true as const, filename: "Pasted export", result })).catch((error: unknown) => ({ ok: false as const, filename: "Pasted export", message: error instanceof Error ? error.message : String(error) })) : null;
    const results = await Promise.all([...fileJobs, ...(pasteJob ? [pasteJob] : [])]);
    const successful = results.filter((result) => result.ok);
    const failed = results.length - successful.length;
    const records = successful.reduce((sum, result) => sum + (result.ok ? result.result.records || 0 : 0), 0);
    const completedIds = new Set(successful.flatMap((result) => "id" in result ? [result.id] : []));
    setUploads((current) => current.filter((item) => !completedIds.has(item.id)));
    if (successful.length) {
      const timestamp = new Date().toISOString();
      const additions = successful.map((result, index) => ({ id: `${connector.id}:${timestamp}:${index}`, label: result.filename, detail: repository || branch || "Manual import", timestamp, records: result.ok ? result.result.records || 0 : 0, kind: "import" as const }));
      setHistory((current) => [...additions, ...current]);
      if (hasPaste && !failed) setContent("");
    }
    setState(failed ? { kind: "error", message: `${successful.length} imported · ${failed} failed. ${records} records added.` } : { kind: "ok", message: `${results.length} ${results.length === 1 ? "source" : "sources"} imported · ${records} records added.` });
  }

  async function sync() {
    if (connector.source === "notion" && connector.mode.startsWith("MCP") && !mcpQuery.trim()) {
      return setState({ kind: "error", message: "Enter a Notion search query before syncing." });
    }
    setState({ kind: "busy", message: `Syncing ${connector.name}…` });
    try {
      const isNotionMcp = connector.source === "notion" && connector.mode.startsWith("MCP");
      const response = await fetch(`/api/connections/${connector.id}/sync`, {
        method: "POST",
        headers: isNotionMcp ? { "Content-Type": "application/json" } : undefined,
        body: isNotionMcp ? JSON.stringify({ arguments: { query: mcpQuery.trim() } }) : undefined,
      });
      const result = await response.json() as ImportResponse;
      if (!response.ok) throw new Error(result.error || "Sync failed");
      const timestamp = new Date().toISOString();
      const transport = isLocal ? "memory" : connector.transport === "mcp-http" ? "MCP" : "API";
      setHistory((current) => [{ id: `${connector.id}:${timestamp}`, label: isLocal ? "Local memory sync" : `Authenticated ${transport} sync`, detail: connector.scope, timestamp, records: result.records || 0, kind: "import" }, ...current]);
      setState({ kind: "ok", message: `${result.records} ${transport} records added to the graph.` });
    } catch (error) { setState({ kind: "error", message: error instanceof Error ? error.message : String(error) }); }
  }

  async function connectNotion() {
    setState({ kind: "busy", message: "Opening Notion authorization…" });
    try {
      const response = await fetch("/api/connections/mcp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "Notion", serverUrl: "https://mcp.notion.com/mcp", profile: "notion", source: "notion", arguments: {} }),
      });
      const result = await response.json() as McpResponse;
      if (!response.ok || !result.authorizationUrl) throw new Error(result.error || "Could not start Notion authorization");
      window.location.assign(result.authorizationUrl);
    } catch (error) { setState({ kind: "error", message: error instanceof Error ? error.message : String(error) }); }
  }

  const importCount = uploads.length + (content.trim() ? 1 : 0);
  const panelId = `${connector.id}-upload-panel`;
  const installationId = Number(connector.metadata?.installationId) || null;
  const githubConnected = connector.source === "github" && Boolean(installationId);
  const isMcp = connector.transport === "mcp-http";
  const canSync = isMcp ? connector.status === "connected" || connector.authType === "oauth" && connector.status === "needs_attention" : connector.source !== "github" ? connector.configured : githubConnected || connector.legacyConfigured;
  const fileBased = connector.source === "claude" || connector.source === "codex";
  const statusLabel = connector.status === "connected" ? fileBased && !isMcp ? "Records imported" : "Connected" : connector.status === "authorizing" ? "Finish setup" : connector.status === "needs_attention" ? "Needs attention" : connector.configured ? "Ready to connect" : "Not connected";
  const githubNotice = notice ? githubNotices[notice] : undefined;
  return <article className={`connector-tile ${open ? "open" : ""}`} style={{ "--connector": connector.accent } as CSSProperties}>
    <button type="button" className={`connector-card ${open ? "selected" : ""}`} style={{ "--connector": connector.accent } as CSSProperties} onClick={() => setOpen((current) => !current)} aria-expanded={open} aria-controls={panelId}>
      <span className="connector-logo"><SourceLogo source={connector.source || connector.id}/></span>
      <span className="connector-card-copy"><strong>{connector.name}</strong><small>{connector.description}</small></span>
      <span className={`connector-state ${githubConnected || connector.status === "connected" || !isMcp && connector.configured && connector.source !== "github" ? "online" : ""}`}><i/>{statusLabel}</span>
      <span className="connector-mode"><span>{isMcp ? "Live sync via MCP" : connector.source === "claude" ? "Claude Code + file import" : connector.source === "github" ? "GitHub App" : "Live API or file import"}</span><b>{open ? "Close setup" : "Open setup"}<svg viewBox="0 0 16 16" aria-hidden="true"><path d="m4.5 6 3.5 3.5L11.5 6"/></svg></b></span>
    </button>

    {open && <section id={panelId} className="connector-inline" aria-label={`${connector.name} uploads`}>
      <div className="setup-flow" aria-label={`${connector.name} setup steps`}>
        <div className="setup-flow-head"><div><strong>Set up {connector.name}</strong><span>{connector.source === "claude" ? "Claude reads from and writes to Temporal through Temporal’s MCP server." : `Connect ${connector.name} directly, then bring its records into the graph.`}</span></div><b>{connector.status === "connected" ? "Connected" : "Setup"}</b></div>
        <ol>
          <li className={connector.status === "connected" ? "done" : "current"}><i>1</i><div><strong>Connect</strong><span>{connector.source === "claude" ? "Approve Temporal in Claude Code" : `Authorize ${connector.name}`}</span></div></li>
          <li className={connector.status === "connected" ? "current" : ""}><i>2</i><div><strong>{connector.source === "claude" ? "Record" : "Sync"}</strong><span>{connector.source === "claude" ? "Ask Claude to record the session" : "Choose what to import"}</span></div></li>
          <li><i>3</i><div><strong>Verify</strong><span>Confirm records in company memory</span></div></li>
        </ol>
      </div>
      {connector.source === "claude" && <div className="connector-guide">
        <strong>Connect Claude Code to Temporal</strong>
        <p>This repository already contains the project MCP configuration. Start Temporal, then launch Claude from this repository:</p>
        <code>export TEMPORAL_COLLECTOR_TOKEN="$(sed -n &apos;s/^TEMPORAL_COLLECTOR_TOKEN=//p&apos; .env.local)"{`\n`}claude</code>
        <p>In Claude, run <code>/mcp</code> and approve <strong>temporal</strong>. Then ask Claude to “record this session in Temporal.” Use the file importer below for an existing session.</p>
      </div>}
      {connector.source === "notion" && !isMcp && <div className="connector-guide connector-guide-action">
        <div><strong>Connect Notion directly</strong><p>Temporal opens Notion OAuth. After approval, return here, enter a search topic, and sync matching pages.</p></div>
        <button type="button" className="primary-action" onClick={connectNotion} disabled={state.kind === "busy"}>Connect Notion</button>
      </div>}
      {(connector.source === "slack" || connector.source === "jira") && !connector.configured && !isMcp && <div className="connector-guide">
        <strong>Live sync needs server credentials</strong>
        <p>Add <code>{connector.env?.join(", ")}</code> to <code>.env.local</code>, then restart Temporal. You can use the file importer below without credentials.</p>
      </div>}
      {isMcp && connector.status === "authorizing" && <div className="github-auth">
        <div className="github-auth-copy"><span className="github-auth-icon"><SourceLogo source={connector.source || connector.id}/></span><div><strong>Authorization required</strong><span>Complete the source OAuth flow before Temporal can discover or sync records.</span></div></div>
        <a className="github-auth-action primary-action" href={`/api/auth/mcp/${connector.id}/start`}>Authorize {connector.name}</a>
      </div>}
      {connector.source === "github" && <div className={`github-auth ${githubConnected ? "connected" : ""}`}>
        {githubNotice && <p className={`github-notice ${githubNotice.kind}`} role="status">{githubNotice.message}</p>}
        <div className="github-auth-copy">
          <span className="github-auth-icon"><SourceLogo source="github"/></span>
          <div>{githubConnected ? <><strong>{String(connector.metadata?.accountLogin || "GitHub")} is connected</strong><span>{Number(connector.metadata?.repositoryCount || 0)} authorized repositories · short-lived installation tokens</span></> : connector.appConfigured ? <><strong>Connect repository access</strong><span>Install the Temporal GitHub App and choose the repositories it may read.</span></> : connector.legacyConfigured ? <><strong>Legacy token active</strong><span>Sync works, but a GitHub App is required for user-selected repository access and native webhooks.</span></> : <><strong>GitHub App setup required</strong><span>Add the app ID, slug, and private key to the server environment.</span></>}</div>
        </div>
        {githubConnected ? <a className="github-auth-action secondary-action" href={typeof connector.metadata?.installationUrl === "string" ? connector.metadata.installationUrl : `/api/auth/github/start`} target="_blank" rel="noreferrer">Manage access</a> : connector.appConfigured ? <a className="github-auth-action primary-action" href="/api/auth/github/start">Connect GitHub</a> : <><a className="github-auth-action primary-action" href="/api/setup/github/manifest/start">Create Temporal app</a><code>Creates credentials, webhook, and least-privilege permissions automatically</code></>}
      </div>}
      <div className="inline-history">
        <div className="inline-section-title"><span>Imported records</span><b>{history.length}</b></div>
        {history.length ? <ol>{history.map((item) => <li key={item.id}><i className={item.kind}/><div><strong>{item.label}</strong><span>{item.records} {item.records === 1 ? "record" : "records"} · {formatTimestamp(item.timestamp)}</span></div></li>)}</ol> : <p>No uploads or syncs yet.</p>}
      </div>
      <div className="inline-composer">
        <div className="inline-section-title"><span>{canSync ? "Sync or import" : "Import a file"}</span><b>{isMcp ? "Live" : "Fallback"}</b></div>
        <div className="inline-fields">
          <label><span>Repository <small>optional</small></span><input value={repository} onChange={(event) => setRepository(event.target.value)} placeholder="org/repository"/></label>
          <label><span>Branch <small>optional</small></span><input value={branch} onChange={(event) => setBranch(event.target.value)} placeholder="feature/my-change"/></label>
        </div>
        <input ref={fileRef} type="file" accept={connector.accepts} multiple hidden onChange={(event) => event.target.files && queueFiles(event.target.files)}/>
        <div className={`inline-dropzone ${dragging ? "dragging" : ""}`} onDragEnter={(event) => { event.preventDefault(); setDragging(true); }} onDragOver={(event) => event.preventDefault()} onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node)) setDragging(false); }} onDrop={onDrop}>
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 16V4m0 0L7.5 8.5M12 4l4.5 4.5M5 15v4h14v-4"/></svg>
          <div><strong>Drop multiple files</strong><span>{connector.accepts.replaceAll(",", ", ")}</span></div>
          <button type="button" className="secondary-action" onClick={() => fileRef.current?.click()}>Choose files</button>
        </div>
        {uploads.length > 0 && <ul className="inline-upload-queue" aria-label={`${connector.name} files ready to import`}>{uploads.map((item) => <li key={item.id} className={item.status}><i/><div><strong>{item.file.name}</strong><span>{item.message || formatBytes(item.file.size)}</span></div>{item.status !== "importing" && <button type="button" onClick={() => setUploads((current) => current.filter((upload) => upload.id !== item.id))} aria-label={`Remove ${item.file.name}`}><svg viewBox="0 0 20 20" aria-hidden="true"><path d="m6 6 8 8m0-8-8 8"/></svg></button>}</li>)}</ul>}
        <label className="inline-paste"><span>Or paste an export <small>optional</small></span><textarea value={content} onChange={(event) => setContent(event.target.value)} placeholder={`Paste ${connector.name} JSON, JSONL, or text…`}/></label>
        {isMcp && connector.source === "notion" && <label className="inline-paste"><span>Notion search query</span><input value={mcpQuery} onChange={(event) => setMcpQuery(event.target.value)} placeholder="Project name, ticket, or decision topic"/></label>}
        <div className="inline-actions">
          {canSync && <button type="button" className="secondary-action" onClick={sync} disabled={state.kind === "busy"}>{isLocal ? "Sync memory" : isMcp ? "Sync now" : "Sync API"}</button>}
          <button type="button" className="primary-action" onClick={importDump} disabled={state.kind === "busy"}>{state.kind === "busy" ? "Importing…" : importCount ? `Import ${importCount} ${importCount === 1 ? "source" : "sources"}` : "Add to graph"}</button>
          <p className={`import-result ${state.kind}`} role="status">{state.message || "Files stay isolated to this connector until import."}</p>
        </div>
      </div>
    </section>}
  </article>;
}

function CustomMcpConnector() {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("Remote MCP");
  const [serverUrl, setServerUrl] = useState("");
  const [profile] = useState("generic");
  const [source, setSource] = useState("notion");
  const [toolName, setToolName] = useState("");
  const [discoveredTools, setDiscoveredTools] = useState<string[]>([]);
  const [state, setState] = useState<{ kind: "idle" | "busy" | "ok" | "error"; message?: string }>({ kind: "idle" });

  async function inspect() {
    setState({ kind: "busy", message: "Discovering tools and resources…" });
    try {
      const response = await fetch("/api/connections/mcp/discover", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ serverUrl, profile }) });
      const result = await response.json() as McpResponse;
      if (!response.ok) throw new Error(result.authorizationRequired ? "Authorization is required. OAuth connection is the next implementation slice." : result.error || "Discovery failed");
      const tools = (result.capabilities?.tools || []).flatMap((tool) => tool && typeof tool === "object" && "name" in tool && typeof tool.name === "string" ? [tool.name] : []);
      setDiscoveredTools(tools);
      setToolName((current) => tools.includes(current) ? current : tools[0] || "");
      const missing = result.assessment?.missing.length ? ` Missing: ${result.assessment.missing.join(", ")}.` : "";
      setState({ kind: result.assessment?.compatible === false ? "error" : "ok", message: `${result.capabilities?.tools.length || 0} tools · ${result.capabilities?.resources.length || 0} resources.${missing}` });
    } catch (error) { setState({ kind: "error", message: error instanceof Error ? error.message : String(error) }); }
  }

  async function connect() {
    if (!toolName) return setState({ kind: "error", message: "Inspect the server and choose the read tool Temporal should call." });
    setState({ kind: "busy", message: "Connecting and verifying capabilities…" });
    try {
      const response = await fetch("/api/connections/mcp", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name, serverUrl, profile, source, toolName, arguments: {} }) });
      const result = await response.json() as McpResponse;
      if (!response.ok) throw new Error(result.error || "Connection failed");
      if (result.authorizationRequired && result.authorizationUrl) {
        setState({ kind: "busy", message: "Opening Notion authorization…" });
        window.location.assign(result.authorizationUrl);
        return;
      }
      setState({ kind: "ok", message: "MCP connection saved. Refresh to see its connection state." });
    } catch (error) { setState({ kind: "error", message: error instanceof Error ? error.message : String(error) }); }
  }

  return <article className={`connector-tile connector-advanced ${open ? "open" : ""}`} style={{ "--connector": "#4de3e8" } as CSSProperties}>
    <button type="button" className={`connector-card connector-add ${open ? "selected" : ""}`} onClick={() => setOpen((current) => !current)} aria-expanded={open} aria-controls="custom-mcp-panel">
      <span>+</span><strong>Other MCP server</strong><small>Advanced: connect a remote Streamable HTTP server.</small>
    </button>
    {open && <section id="custom-mcp-panel" className="connector-inline" aria-label="Custom MCP connection">
      <div className="inline-composer">
        <div className="inline-section-title"><span>Remote MCP server</span><b>Streamable HTTP</b></div>
        <div className="inline-fields">
          <label><span>Connection name</span><input value={name} onChange={(event) => setName(event.target.value)} placeholder="Workspace knowledge"/></label>
          <label><span>Import records as</span><select value={source} onChange={(event) => setSource(event.target.value)}><option value="notion">Notion documents</option><option value="slack">Slack messages</option><option value="jira">Jira issues</option><option value="claude">Claude sessions</option><option value="codex">Codex sessions</option><option value="github">GitHub records</option></select></label>
        </div>
        <label className="inline-paste"><span>Server URL</span><input value={serverUrl} onChange={(event) => setServerUrl(event.target.value)} placeholder="https://mcp.example.com/mcp"/></label>
        {discoveredTools.length > 0 && <label className="inline-paste"><span>Read tool</span><select value={toolName} onChange={(event) => setToolName(event.target.value)}>{discoveredTools.map((tool) => <option value={tool} key={tool}>{tool}</option>)}</select></label>}
        <div className="inline-actions">
          <button type="button" className="secondary-action" onClick={inspect} disabled={state.kind === "busy"}>Inspect capabilities</button>
          <button type="button" className="primary-action" onClick={connect} disabled={state.kind === "busy" || !toolName}>Connect server</button>
          <p className={`import-result ${state.kind}`} role="status">{state.message || "Only HTTPS servers are accepted. Private-network endpoints and credentials in URLs are blocked."}</p>
        </div>
      </div>
    </section>}
  </article>;
}

export default function ConnectionsClient({ connectors, githubNotice }: { connectors: Connector[]; githubNotice?: string }) {
  return <>
    <section className="connector-grid" aria-label="Available connectors">
      {connectors.map((connector) => <ConnectorTile connector={connector} notice={connector.source === "github" ? githubNotice : undefined} key={connector.id}/>)}
    </section>
    <section className="advanced-connections">
      <div><strong>Need another MCP server?</strong><p>Use this only when the source is not covered by a connector above.</p></div>
      <CustomMcpConnector/>
    </section>
  </>;
}
