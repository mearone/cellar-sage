// Run with: npx tsx scripts/validate-fees.ts
import fs from "node:fs";
import path from "node:path";
import yaml from "js-yaml";
import * as cheerio from "cheerio";
import { fetch } from "undici";

type House = {
  name: string;
  buyers_premium: number;
  last_verified?: string;
  source_url: string;
  parse: { regex: string; multiplier: number };
};

type FeesFile = { auction_houses: House[] };

function loadFees(): FeesFile {
  const p = path.join(process.cwd(), "config", "fees.yaml");
  const raw = fs.readFileSync(p, "utf8");
  return yaml.load(raw) as FeesFile;
}

function saveFees(fees: FeesFile) {
  const p = path.join(process.cwd(), "config", "fees.yaml");
  const y = yaml.dump(fees, { lineWidth: 120 });
  fs.writeFileSync(p, y, "utf8");
}

async function verifyHouse(house: House) {
  const res = await fetch(house.source_url, {
    headers: { "user-agent": "AIWineAssistant/1.0 (+https://example.com)" },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} fetching ${house.source_url}`);
  const html = await res.text();
  const $ = cheerio.load(html);
  const txt = $("body").text().replace(/\s+/g, " ").trim();

  const re = new RegExp(house.parse.regex);
  const m = txt.match(re);
  if (!m || !m[1]) return { status: "no_match" as const, found: null };
  const pct = Number(m[1]);
  if (Number.isNaN(pct)) return { status: "parse_error" as const, found: null };
  const decimal = pct * house.parse.multiplier;
  return { status: "ok" as const, found: decimal };
}

function nearlyEqual(a: number, b: number, eps = 0.001) {
  return Math.abs(a - b) <= eps;
}

async function main() {
  const fees = loadFees();
  const changes: { name: string; old: number; new: number; url: string }[] = [];
  const failures: { name: string; reason: string; url: string }[] = [];

  for (const h of fees.auction_houses) {
    try {
      console.log(`Checking ${h.name} ...`);
      const { status, found } = await verifyHouse(h);
      if (status !== "ok" || found == null) {
        failures.push({ name: h.name, reason: status, url: h.source_url });
        continue;
      }
      if (!nearlyEqual(found, h.buyers_premium)) {
        changes.push({ name: h.name, old: h.buyers_premium, new: found, url: h.source_url });
        h.buyers_premium = found; // update
      }
      h.last_verified = new Date().toISOString().slice(0, 10);
    } catch (e: any) {
      failures.push({ name: h.name, reason: e.message || "error", url: h.source_url });
    }
  }

  saveFees(fees);

  console.log("\n=== Summary ===");
  if (changes.length) {
    console.log("Changes detected:");
    for (const c of changes) console.log(`- ${c.name}: ${c.old} -> ${c.new} (${c.url})`);
  } else {
    console.log("No changes detected.");
  }
  if (failures.length) {
    console.log("\nFailures:");
    for (const f of failures) console.log(`- ${f.name}: ${f.reason} (${f.url})`);
  }
}

main().catch(err => { console.error(err); process.exit(1); });
