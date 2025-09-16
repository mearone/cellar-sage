import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase";

export async function GET() {
  const url = process.env.SUPABASE_URL || "(missing)";
  try {
    const sb = supabaseServer();
    const { data, error } = await sb.from("fees").select("house,buyers_premium,last_verified").order("house");
    return NextResponse.json({ supabaseUrl: url, fees: data ?? [], error: error?.message ?? null }, {
      headers: { "Cache-Control": "no-store" }
    });
  } catch (e: any) {
    return NextResponse.json({ supabaseUrl: url, error: e?.message ?? "unknown" }, { status: 500 });
  }
}
