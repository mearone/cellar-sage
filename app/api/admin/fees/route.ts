import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export async function GET() {
  try {
    const sb = supabaseAdmin();
    const { data, error } = await sb
      .from("fees")
      .select("house,buyers_premium,last_verified,source_url")
      .order("house");
    if (error) throw error;
    return NextResponse.json(data);
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

export async function PUT(req: NextRequest) {
  try {
    const { house, buyers_premium, source_url, last_verified } = await req.json();

    if (!house || typeof buyers_premium !== "number") {
      return NextResponse.json({ error: "house and buyers_premium (number) are required" }, { status: 400 });
    }
    if (buyers_premium < 0 || buyers_premium > 1) {
      return NextResponse.json({ error: "buyers_premium must be a decimal (e.g., 0.23)" }, { status: 400 });
    }

    const sb = supabaseAdmin();

    const { data: current, error: selErr } = await sb
      .from("fees")
      .select("buyers_premium")
      .eq("house", house)
      .maybeSingle();
    if (selErr) throw selErr;

    const payload: any = {
      house,
      buyers_premium,
      source_url: source_url ?? null,
      last_verified: last_verified ?? new Date().toISOString().slice(0, 10),
    };

    const { error: upErr } = await sb
      .from("fees")
      .upsert(payload, { onConflict: "house" });
    if (upErr) throw upErr;

    const old = current?.buyers_premium ?? null;
    if (old === null || Math.abs(old - buyers_premium) >= 1e-6) {
      await sb.from("fees_audit").insert({
        house,
        old_rate: old,
        new_rate: buyers_premium,
        source_url: payload.source_url,
      });
    }

    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ error: e.message ?? "error" }, { status: 500 });
  }
}
