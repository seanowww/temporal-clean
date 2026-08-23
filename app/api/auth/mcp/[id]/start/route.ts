import { NextResponse } from "next/server";
import { beginMcpOAuth } from "@/lib/mcp/oauth";

export const runtime = "nodejs";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    return NextResponse.redirect(await beginMcpOAuth(id));
  } catch (error) {
    const url = new URL("/connections", process.env.TEMPORAL_APP_URL || "http://localhost:3000");
    url.searchParams.set("mcp", "oauth_error");
    url.searchParams.set("message", error instanceof Error ? error.message : String(error));
    return NextResponse.redirect(url);
  }
}
