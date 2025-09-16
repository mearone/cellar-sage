import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase";

export async function GET() {
  const sb = supabaseServer();
  const { data, error } = await sb
    .from("fees")
    .select("house,buyers_premium,last_verified,source_url")
    .order("house");
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}
