import Link from "next/link";
import { getDashboardData } from "@/lib/dashboard";
import ConnectionsClient from "./connections-client";
import { connectorCatalog, connectorRuntimeState } from "@/lib/connectors/catalog";
import { listGraphNodes } from "@/lib/store";

export const dynamic = "force-dynamic";

export default async function ConnectionsPage({ searchParams }: { searchParams: Promise<{ github?: string }> }) {
  const githubNotice = (await searchParams).github;
  const { connections } = await getDashboardData();
  const nodes = listGraphNodes();
  const connectors = connectorCatalog.map((definition) => {
    const sourceConnections = connections.filter((connection) => connection.id === definition.id || connection.source === definition.id);
    const connection = sourceConnections.find((candidate) => candidate.transport === "mcp-http" && candidate.status === "connected") || sourceConnections.find((candidate) => candidate.transport === "mcp-http") || sourceConnections.find((candidate) => candidate.id === definition.id) || { status: "planned" as const, scope: "Not configured", lastSync: undefined };
    // claude-mem writes under the `claude` source so graph linkage and logos stay shared;
    // `metadata.provider` is what attributes a record back to its own connector tile.
    const sourceNodes = nodes.filter((node) => (node.metadata?.provider ? node.metadata.provider === definition.id : node.source === definition.id));
    const imports = new Map<string, { timestamp?: string; records: number; detail: string }>();
    for (const node of sourceNodes) {
      const importedFrom = typeof node.metadata?.importedFrom === "string" ? node.metadata.importedFrom : null;
      if (!importedFrom) continue;
      const current = imports.get(importedFrom) || {
        timestamp: typeof node.metadata?.importedAt === "string" ? node.metadata.importedAt : node.occurredAt,
        records: 0,
        detail: node.repository || node.branch || "Manual import",
      };
      current.records += 1;
      imports.set(importedFrom, current);
    }
    const history: Array<{ id: string; label: string; detail: string; timestamp?: string; records: number; kind: "connection" | "import" }> = [...imports.entries()].map(([label, activity], index) => ({ id: `${definition.id}:import:${index}:${label}`, label, ...activity, kind: "import" }));
    if (connection.status === "connected") history.unshift({
      id: `${definition.id}:connection`,
      label: connection.scope || "Connected workspace",
      detail: definition.auth === "file" ? "Local import connection" : definition.env.every((name) => Boolean(process.env[name])) ? "Authenticated API connection" : "Imported connection",
      timestamp: connection.lastSync,
      records: sourceNodes.length,
      kind: "connection" as const,
    });
    const runtime = connectorRuntimeState(definition);
    const transport = "transport" in connection ? connection.transport : undefined;
    const metadata = "metadata" in connection ? connection.metadata : undefined;
    const configuration = "configuration" in connection ? connection.configuration : undefined;
    return {
      ...runtime,
      id: "id" in connection ? connection.id : definition.id,
      name: definition.name,
      description: definition.description,
      source: definition.id,
      accent: definition.accent,
      accepts: definition.accepts,
      mode: transport === "mcp-http" ? "Direct MCP" : runtime.mode,
      status: connection.status,
      scope: connection.scope,
      lastSync: connection.lastSync,
      transport,
      authType: "authType" in connection ? connection.authType : undefined,
      configuration: configuration?.arguments ? { arguments: configuration.arguments } : undefined,
      metadata: metadata ? {
        installationId: metadata.installationId,
        accountLogin: metadata.accountLogin,
        repositoryCount: metadata.repositoryCount,
        installationUrl: metadata.installationUrl,
        lastError: metadata.lastError,
      } : undefined,
      history,
    };
  });
  return (
    <main className="settings-shell">
      <header className="settings-head">
        <div><Link href="/" className="back-link">Back to company memory</Link><h1>Connect your tools</h1><p>One source, one setup. Connect live access or import a file, then verify the result here.</p></div>
        <span className="security-state"><i/>{connectors.filter((connector) => connector.status === "connected").length} sources with data</span>
      </header>
      <ConnectionsClient connectors={connectors} githubNotice={githubNotice}/>
      <aside className="policy-note"><strong>Permission boundary</strong><p>Source ACLs are evaluated before traversal. Restricted records cannot contribute content, summaries, or inferred facts to an artifact unless the viewer subject is allowed.</p></aside>
    </main>
  );
}
