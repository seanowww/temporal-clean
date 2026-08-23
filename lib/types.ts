export type ConnectionStatus = "connected" | "authorizing" | "needs_attention" | "disabled" | "planned";
export type ConnectionTransport = "mcp-http" | "mcp-stdio" | "rest" | "webhook" | "file";
export type ConnectionAuthType = "oauth" | "bearer" | "environment" | "none";

export type McpCapabilitySnapshot = {
  server?: { name: string; version: string };
  protocolVersion?: string;
  tools: Array<{ name: string; description?: string; inputSchema?: Record<string, unknown> }>;
  resources: Array<{ uri: string; name: string; description?: string; mimeType?: string }>;
  resourceTemplates: Array<{ uriTemplate: string; name: string; description?: string; mimeType?: string }>;
  discoveredAt: string;
};

export type Connection = {
  id: string;
  source?: string;
  name: string;
  description: string;
  status: ConnectionStatus;
  scope: string;
  lastSync?: string;
  transport?: ConnectionTransport;
  serverUrl?: string;
  authType?: ConnectionAuthType;
  capabilities?: McpCapabilitySnapshot;
  configuration?: Record<string, unknown>;
  syncCursor?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
};

export type PullRequestRecord = {
  id: string;
  number: number;
  repository: string;
  title: string;
  author: string;
  status: "ready" | "building" | "limited";
  eventCount: number;
  sourceCount: number;
  updatedAt: string;
  synthetic?: boolean;
  countLabel?: string;
};

export type ArtifactEvent = Record<string, unknown> & {
  id: string;
  t: number;
  src: string;
  title: string;
};

export type ArtifactPayload = {
  id: string;
  pullRequestId: string;
  version: number;
  status: "ready" | "building" | "limited" | "failed";
  generatedAt: string;
  summary: string;
  events: ArtifactEvent[];
  edges: [string, string, string][];
  coverage: { source: string; records: number; status: string }[];
  excluded?: { transcriptDetail: number; outsideWindow: number };
  /** Known-missing evidence, stated plainly rather than implied by silence. */
  gaps?: string[];
  /** True only when selected evidence contains a real rejected/pruned branch. */
  hasPrunedBranch?: boolean;
  pullRequest?: {
    number: number;
    repository: string;
    title: string;
    author: string;
    filesChanged?: number;
    additions?: number;
    deletions?: number;
  };
};
