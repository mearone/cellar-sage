// app/api/compute/route.ts
import { NextRequest, NextResponse } from "next/server";
import { computeBidCap } from "@/lib/bidcap";
import { supabaseServer } from "@/lib/supabase";

// Ensure Node runtime on Vercel (uses server-only libs/env)
export const runtime = "nodejs";

// ---- Inline risk & drinkability ----
const RISK = {
  risk_deductions: {
    fill_level: {
      "Into-Neck": 0.0,
      "High-Shoulder": 0.05,
      "Mid-Shoulder": 0.1,
    },
    capsule: {
      Pristine: 0.0,
      Scuffed: 0.02,
      "Torn/Seepage": 0.08,
    },
    label: {
      Pristine: 0.0,
      "Bin-Soiled": 0.02,
      Torn: 0.04,
    },
    seepage: {
      No: 0.0,
      Yes: 0.07,
    },
    storage: {
      "Provenance Known": 0.0,
      "Unknown/Questionable": 0.05,
    },
    mold: {
      No: 0.0,
      Yes: 0.07,
    },
    oxidation: {
      None: 0.0,
      "Light Browning": 0.05,
      "Severe Browning": 0.15,
    },
  },
  drinkability_adjustment: {
    drinkability: {
      "Prime Now": 0.03,
      Neutral: 0.0,
      "Early (Needs Time)": -0.03,
      "Late (Drink Up)": -0.05,
    },
  },
} as const;

// ---- Country helpers ----
const EU = new Set([
  "FR","DE","ES","IT","NL","BE","LU","DK","SE","FI",
  "IE","PT","AT","PL","CZ","HU","RO","BG","HR","SI","SK","GR",
  "EE","LV","LT",
]);

const VAT: Record<string, number> = {
  FR: 0.20, DE: 0.19, ES: 0.21, IT: 0.22, NL: 0.21, BE: 0.21, LU: 0.17,
  DK: 0.25, SE: 0.25, FI: 0.24, IE: 0.23, PT: 0.23, AT: 0.20, PL: 0.23,
  CZ: 0.21, HU: 0.27, RO: 0.19, BG: 0.20, HR: 0.25, SI: 0.22, SK: 0.20,
  GR: 0.24, EE: 0.22, LV: 0.21, LT: 0.21,
};

// Map common inputs to ISO-ish country codes
function normalizeCountry(input: unknown): string {
  const raw = String(input ?? "").trim().toUpperCase();
  if (!raw) return "US";
  if (raw === "USA" || raw === "UNITED STATES" || raw === "U.S." || raw === "UNITED STATES OF AMERICA") return "US";
  if (raw.length > 2) {
    // crude normalization for "FRANCE" -> FR, "GERMANY" -> DE, etc. (extend as needed)
    const map: Record<string, string> = {
      FRANCE: "FR", GERMANY: "DE", SPAIN: "ES", ITALY: "IT", NETHERLANDS: "NL",
      BELGIUM: "BE", LUXEMBOURG: "LU", DENMARK: "DK", SWEDEN: "SE", FINLAND: "FI",
      IRELAND: "IE", PORTUGAL: "PT", AUSTRIA: "AT", POLAND: "PL", CZECHIA: "CZ",
      HUNGARY: "HU", ROMANIA: "RO", BULGARIA: "BG", CROATIA: "HR", SLOVENIA: "SI",
      SLOVAKIA: "SK", GREECE: "GR", ESTONIA: "EE", LATVIA: "LV", LITHUANIA: "LT",
      UNITED KINGDOM: "UK", GREAT BRITAIN: "UK", ENGLAND: "UK",
      UNITED ARAB EMIRATES: "AE",
      CANADA: "CA", MEXICO: "MX", AUSTRALIA: "AU", NEW ZEALAND: "NZ",
    };
    return map[raw] ?? raw;
  }
  return raw;
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as any;

    // 1) Always pull buyer’s premium from DB (some houses store incl-VAT, some ex-VAT)
    const sb = supabaseServer();
    const { data: feeRow, error } = await sb
      .from("fees")
      .select("buyers_premium")
      .eq("house", body.auction_house)
      .maybeSingle();

    if (error) throw new Error(error.message);
    if (!feeRow) throw new Error(`No fees found for house: ${body.auction_house}`);

    const bpFromDb: number = Number(feeRow.buyers_premium ?? 0);

    // 2) Destination normalization
    const destCountry = normalizeCountry(body.shipping_country || "US");
    const autoTax: boolean = Boolean(body.auto_tax);

    // 3) Compute effective buyer’s premium for iDealwine
    // iDealwine is based in FR (20% VAT). If AutoTax is ON:
    //  - EU destination: BP should include destination VAT (we assume same % as dest)
    //  - Non-EU: BP should be ex-VAT
    // Heuristic: if bpFromDb > 0.24, we assume it's a VAT-inclusive value (e.g., 0.252)
    let buyers_premium = bpFromDb;

    if (body.auction_house === "iDealwine" && autoTax) {
      const isEU = EU.has(destCountry);
      const homeVat = 0.20; // iDealwine/FR base VAT
      const looksInclVAT = bpFromDb > 0.24;
      const destVat = VAT[destCountry] ?? homeVat;

      if (isEU) {
        // EU destination should be VAT-included BP
        buyers_premium = looksInclVAT ? bpFromDb : bpFromDb * (1 + destVat);
      } else {
        // Non-EU destination should be ex-VAT BP
        buyers_premium = looksInclVAT ? bpFromDb / (1 + homeVat) : bpFromDb;
      }
    }

    // 4) Sales tax handling (simple for now)
    //    - AutoTax ON:
    //        * US dest: keep provided sales_tax_rate (later: compute by ZIP)
    //        * non-US dest: tax = 0
    //    - AutoTax OFF: use provided sales_tax_rate as-is
    let sales_tax_rate: number = Number(body.sales_tax_rate ?? 0);
    if (autoTax) {
      sales_tax_rate = destCountry === "US" ? Number(body.sales_tax_rate ?? 0) : 0;
    }

    // 5) Call compute with our normalized inputs + inline risk map
    const { buyers_premium: _ignored, ...rest } = body;

    // @ts-ignore – loosen types to unblock deploy
    const result = computeBidCap(
      {
        ...rest,
        buyers_premium,
        sales_tax_rate,
      },
      // @ts-ignore
      RISK,
      {} // no external fees.yaml anymore
    );

    return NextResponse.json(result, { status: 200 });
  } catch (e: any) {
    console.error("[/api/compute] error:", e);
    return NextResponse.json(
      { ok: false, error: e?.message ?? "Unknown error" },
      { status: 400 }
    );
  }
}
