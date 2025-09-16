import { NextRequest, NextResponse } from "next/server";
import { loadYaml } from "@/lib/yaml";
import { computeBidCap, ComputeBidCapArgs } from "@/lib/bidcap";

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as ComputeBidCapArgs;
    const riskYaml = loadYaml<any>("config/risk.yaml");
    const feesYaml = loadYaml<any>("config/fees.yaml");
    const result = computeBidCap(body, riskYaml, feesYaml);
    return NextResponse.json(result);
  } catch (e: any) {
    console.error(e);
    return NextResponse.json({ error: e?.message ?? "Unknown error" }, { status: 400 });
  }
}
