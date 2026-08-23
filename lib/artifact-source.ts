import { readFile } from "node:fs/promises";
import path from "node:path";
import type { ArtifactEvent, ArtifactPayload } from "./types";

function readLiteral<T>(source: string, name: string): T {
  const startToken = `const ${name} = `;
  const start = source.indexOf(startToken);
  if (start === -1) throw new Error(`Missing ${name} in artifact renderer`);
  const valueStart = start + startToken.length;
  const end = source.indexOf(";\n", valueStart);
  if (end === -1) throw new Error(`Unterminated ${name} in artifact renderer`);
  const literal = source.slice(valueStart, end);
  return Function(`"use strict"; return (${literal});`)() as T;
}

export async function loadDemoArtifact(): Promise<ArtifactPayload> {
  const artifactPath = path.join(process.cwd(), "public", "artifact", "index.html");
  const source = await readFile(artifactPath, "utf8");
  const events = readLiteral<ArtifactEvent[]>(source, "FALLBACK_EVENTS");
  const edges = readLiteral<[string, string, string][]>(source, "FALLBACK_EDGES");

  return {
    id: "artifact-pr-4471-v1",
    pullRequestId: "pr-4471",
    version: 1,
    status: "ready",
    generatedAt: new Date().toISOString(),
    summary: "Two design reversals and one undocumented schema decision shaped the shipped implementation.",
    events,
    edges,
    coverage: [
      { source: "GitHub", records: 5, status: "complete" },
      { source: "Claude Code", records: 2, status: "complete" },
      { source: "Slack", records: 5, status: "complete" },
      { source: "Notion", records: 2, status: "stale" },
      { source: "Codex", records: 1, status: "complete" },
    ],
  };
}
