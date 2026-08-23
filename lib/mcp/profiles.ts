import type { McpCapabilitySnapshot } from "../types";

export type McpProfile = {
  id: string;
  source: string;
  displayName: string;
  officialServerUrl?: string;
  requiredTools: string[][];
  preferredReadTools: string[];
};

export const mcpProfiles: McpProfile[] = [
  {
    id: "notion",
    source: "notion",
    displayName: "Notion",
    officialServerUrl: "https://mcp.notion.com/mcp",
    requiredTools: [["notion-search", "search"], ["notion-fetch", "fetch"]],
    preferredReadTools: ["notion-search", "search"],
  },
  {
    id: "slack",
    source: "slack",
    displayName: "Slack",
    requiredTools: [["slack_search", "search_messages", "search"]],
    preferredReadTools: ["slack_search", "search_messages", "search"],
  },
  {
    id: "generic",
    source: "custom",
    displayName: "Custom MCP",
    requiredTools: [],
    preferredReadTools: [],
  },
];

export function assessMcpProfile(profileId: string, capabilities: McpCapabilitySnapshot) {
  const profile = mcpProfiles.find((candidate) => candidate.id === profileId) || mcpProfiles.find((candidate) => candidate.id === "generic")!;
  const available = new Set(capabilities.tools.map((tool) => tool.name));
  const missing = profile.requiredTools.filter((alternatives) => !alternatives.some((name) => available.has(name)));
  return {
    profile,
    compatible: missing.length === 0,
    missing: missing.map((alternatives) => alternatives.join(" or ")),
  };
}

export function selectMcpReadTool(profileId: string, capabilities: McpCapabilitySnapshot, configured?: string) {
  const assessment = assessMcpProfile(profileId, capabilities);
  const available = new Set(capabilities.tools.map((tool) => tool.name));
  if (configured) {
    if (!available.has(configured)) throw new Error(`Configured MCP tool ${configured} is not advertised by this server.`);
    return configured;
  }
  return assessment.profile.preferredReadTools.find((name) => available.has(name)) || capabilities.tools[0]?.name || null;
}
