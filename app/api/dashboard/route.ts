import { NextResponse } from "next/server";
import { getDashboardData } from "@/lib/dashboard";

export async function GET() {
  return NextResponse.json(await getDashboardData(), {
    headers: { "Cache-Control": "no-store" },
  });
}
