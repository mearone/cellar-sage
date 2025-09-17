// app/api/compute/route.ts
import { NextRequest, NextResponse } from "next/server";
import { computeBidCap } from "@/lib/bidcap";
import { supabaseServer } from "@/lib/supabase";
import { loadYaml } from "@/lib/yaml";

const EU = new Set([
  "FR","DE","ES","IT","NL","BE","LU","DK","SE","FI",
  "IE","PT","AT","PL","CZ","HU","RO","BG","HR","SI","SK","GR",
  "EE","LV","LT"
]);

// minimal VAT map (standard rates) – adjust as needed
const VAT: Record<string, number> = {
  FR: 0.20, DE: 0.19, ES: 0.21, IT: 0.22, NL: 0.21, BE: 0.21, LU: 0.17,
  DK: 0.25, SE: 0.25, FI: 0.24, IE: 0.23, PT: 0.23, AT: 0.20, PL: 0.23,
  CZ: 0.21, HU: 0.27, RO: 0.19, BG: 0.20, HR: 0.25, SI: 0.22, SK: 0.20,
  GR: 0.24, EE: 0.22, LV: 0.21, LT: 0.21
};

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as any;

    const sb = supabaseServer();
    const { data: feeRow, error } = await sb
      .from("fees")
      .select("buyers_premium")
      .eq("house", body.auction_house)
      .maybeSingle();

    if (error) throw new Error(error.message);
    if (!feeRow) throw new Error(`No fees found for house: ${body.auction_house}`);

    // DB buyers_premium is expected to be ex-VAT for iDealwine; plain for US houses
    const bpFromDb: number = feeRow.buyers_premium;

    // Normalize destination info
    const destCountry = String(body.shipping_country || "US").toUpperCase();
    const autoTax = Boolean(body.auto_tax);

    // Adjust buyer's premium for iDealwine VAT when shipping within EU
    let buyers_premium = bpFromDb;
    if (autoTax && body.auction_house === "iDealwine") {
      if (EU.has(destCountry)) {
        const vatRate = VAT[destCountry] ?? 0.20; // default 20% if missing
        buyers_premium = bpFromDb * (1 + vatRate); // ex-VAT → incl. VAT on BP portion
      } else {
        // outside EU (e.g., US/UK): keep ex-VAT
        buyers_premium = bpFromDb;
      }
    }

    // Sales tax handling (simple rules for now)
    // - If autoTax ON:
    //    * US destination → keep user-entered sales_tax_rate (until we integrate TaxJar/Avalara)
    //    * Non-US destination → 0 sales tax
    // - If autoTax OFF: use user-entered sales_tax_rate as-is
    let sales_tax_rate: number = Number(body.sales_tax_rate ?? 0);
    if (autoTax) {
      if (destCountry === "US") {
        // keep the entered rate for now (ZIP lookup later)
        sales_tax_rate = Number(body.sales_tax_rate ?? 0);
      } else {
        sales_tax_rate = 0;
      }
    }

    // Strip any client-supplied buyers_premium; we only trust our computed value
    const { buyers_premium: _ignored, ...rest } = body;

    const riskYaml = loadYaml<any>("config/risk.yaml");
    const feesYaml = loadYaml<any>("config/fees.yaml");

    const result = computeBidCap(
      {
        ...rest,
        buyers_premium,
        sales_tax_rate,
      },
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
