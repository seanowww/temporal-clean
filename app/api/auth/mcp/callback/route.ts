import { NextResponse } from "next/server";
import { finishMcpOAuth } from "@/lib/mcp/oauth";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const input = new URL(request.url);
  const connectionId = input.searchParams.get("connection") || "";
  const code = input.searchParams.get("code") || "";
  const state = input.searchParams.get("state") || "";
  const destination = new URL("/connections", process.env.TEMPORAL_APP_URL || input.origin);
  try {
    if (!connectionId || !code) throw new Error("Notion did not return an authorization code.");
    await finishMcpOAuth(connectionId, code, state);
    destination.searchParams.set("mcp", "connected");
    destination.searchParams.set("connection", connectionId);
  } catch (error) {
    destination.searchParams.set("mcp", "oauth_error");
    destination.searchParams.set("message", error instanceof Error ? error.message : String(error));
  }
  return NextResponse.redirect(destination);
}
