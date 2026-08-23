import { NextResponse } from "next/server";
import { getConnector } from "@/lib/connectors/catalog";
import { ingestConnectorDump } from "@/lib/connectors/ingest";

export const runtime = "nodejs";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const connector = getConnector(id);
  if (!connector) return NextResponse.json({ error: "Unsupported connector" }, { status: 404 });
  try {
    const body = await request.json() as { content?: string; filename?: string; repository?: string; branch?: string };
    if (!body.content?.trim()) return NextResponse.json({ error: "Paste or upload a non-empty export" }, { status: 400 });
    const result = ingestConnectorDump(connector.id, body.content, { filename: body.filename, repository: body.repository, branch: body.branch, importedAt: new Date().toISOString() });
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 422 });
  }
}
