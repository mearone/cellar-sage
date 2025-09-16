import { NextRequest, NextResponse } from "next/server";
import { computeBidCap } from "@/lib/bidcap";
import { supabaseServer } from "@/lib/supabase";
import { loadYaml } from "@/lib/yaml";

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as any;

    // Always get BP from DB (ignore whatever client sends)
    const sb = supabaseServer();
    const { data: feeRows, error } = await sb
      .from("fees")
      .select("buyers_premium")
      .eq("house", body.auction_house)
      .maybeSingle();

    if (error) throw new Error(error.message);
    if (!feeRows) throw new Error(`No fees found for house: ${body.auction_house}`);

    const buyersPremium = feeRows.buyers_premium;

    // Remove any client-supplied buyers_premium and replace with DB one
    const { buyers_premium: _ignored, ...rest } = body;

    const riskYaml = loadYaml<any>("config/risk.yaml");
    const feesYaml = loadYaml<any>("config/fees.yaml");

    const result = computeBidCap(
      { ...rest, buyers_premium: buyersPremium },
      riskYaml,
      feesYaml
    );

    return NextResponse.json(result);
  } catch (e: any) {
    console.error(e);
    return NextResponse.json(
      { error: e?.message ?? "Unknown error" },
      { status: 400 }
    );
  }
}
