type RiskTable = Record<string, Record<string, number>>;

type FeesYaml = {
  auction_houses: { name: string; buyers_premium: number }[];
  sales_tax: { default: number };
};

type RiskYaml = {
  risk_deductions: RiskTable;
  drinkability_adjustment: Record<string, number>;
  target_discount_default?: number;
};

export type ComputeBidCapArgs = {
  auction_house: string;
  retail_anchor_usd: number;
  buyers_premium?: number;
  sales_tax_rate?: number;
  shipping_usd: number;
  target_discount?: number;
  fill_level: string;
  capsule: string;
  label: string;
  seepage: string;
  storage: string;
  mold: string;
  drinkability: string;
};

export type ComputeBidCapResult = {
  preFeeMax: number;
  maxBid: number;
  riskSum: number;
  drinkAdj: number;
  bp: number;
  tax: number;
  targetDiscount: number;
};

export function computeBidCap(args: ComputeBidCapArgs, riskYaml: RiskYaml, feesYaml: FeesYaml): ComputeBidCapResult {
  const fees = feesYaml;
  const risk = riskYaml;

  const bp = args.buyers_premium ?? (fees.auction_houses.find(h => h.name === args.auction_house)?.buyers_premium ?? 0);
  const tax = args.sales_tax_rate ?? fees.sales_tax.default;
  const targetDiscount = args.target_discount ?? (risk.target_discount_default ?? 0.12);

  const r = risk.risk_deductions;
  const riskSum =
    (r.fill_level?.[args.fill_level] ?? 0) +
    (r.capsule?.[args.capsule] ?? 0) +
    (r.label?.[args.label] ?? 0) +
    (r.seepage?.[args.seepage] ?? 0) +
    (r.storage?.[args.storage] ?? 0) +
    (r.mold?.[args.mold] ?? 0);

  const drinkAdj = 1 + (risk.drinkability_adjustment?.[args.drinkability] ?? 0);

  const preFeeMax = args.retail_anchor_usd * (1 - riskSum) * drinkAdj * (1 - targetDiscount);
  const maxBid = (preFeeMax - args.shipping_usd) / (1 + bp + tax);

  return { preFeeMax, maxBid, riskSum, drinkAdj, bp, tax, targetDiscount };
}
