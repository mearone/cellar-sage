// @ts-nocheck
// Validator VERSION: v3
console.log("Validator VERSION: v3");
console.log("Using Supabase URL:", process.env.SUPABASE_URL);

import { createClient } from '@supabase/supabase-js';
import * as cheerio from 'cheerio';

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

// ---- Guardrails: never write junk to DB ----
function isPlausible(p: number) {
  // accept 5%..35% only
  return p >= 0.05 && p <= 0.35;
}
function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

// ---- Parsing helpers ----
function pctNear(text: string, needle: RegExp, window = 300): number | null {
  const idx = text.search(needle);
  const hay = idx >= 0 ? text.slice(Math.max(0, idx - window), idx + window) : text;
  const m = hay.match(/(\d{1,2}(?:\.\d)?)\s?%/);
  if (!m) return null;
  const v = parseFloat(m[1]);
  return Number.isNaN(v) ? null : v / 100;
}
function firstPct(text: string): number | null {
  const m = text.match(/(\d{1,2}(?:\.\d)?)\s?%/);
  if (!m) return null;
  const v = parseFloat(m[1]);
  return Number.isNaN(v) ? null : v / 100;
}

// ---- Fetch (direct + ZenRows fallback) ----
async function fetchDirect(url: string): Promise<string> {
  const res = await fetch(url, {
    headers: {
      "User-Agent": UA,
      "Accept": "text/html,application/xhtml+xml",
      "Accept-Language": "en-US,en;q=0.9",
    },
    redirect: "follow",
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
  return await res.text();
}
async function fetchViaZenRows(url: string): Promise<string> {
  const key = process.env.ZENROWS_API_KEY;
  if (!key) throw new Error("ZENROWS_API_KEY not set");
  const u = new URL("https://api.zenrows.com/v1/");
  u.searchParams.set("url", url);
  u.searchParams.set("apikey", key);
  u.searchParams.set("js_render", "true");
  u.searchParams.set("premium_proxy", "true");
  const res = await fetch(u.toString(), { headers: { "User-Agent": UA } });
  if (!res.ok) throw new Error(`ZenRows HTTP ${res.status} ${res.statusText}`);
  return await res.text();
}
async function getText(url: string): Promise<string> {
  try {
    return await fetchDirect(url);
  } catch {
    return await fetchViaZenRows(url);
  }
}

async function notifySlack(lines: string[]) {
  const hook = process.env.SLACK_WEBHOOK_URL;
  if (!hook) return;
  await fetch(hook, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      text:
        "🍷 Fee validator report\n" +
        `Project: ${process.env.SUPABASE_URL}\n` +
        lines.join("\n"),
    }),
  }).catch(() => {});
}

// ---- Per-house configuration (URLs + parsers) ----
type House = { name: string; url: string; parse: (text: string) => number | null };

const HOUSES: House[] = [
  {
    name: "Acker",
    // FAQ is often more stable and includes "buyer’s premium ... 25%"
    url: "https://www.ackerwines.com/faq/",
    parse: (t) => pctNear(t, /buyer'?s premium/i),
  },
  {
    name: "Spectrum",
    url: "https://www.spectrumwine.com/auctions/terms.aspx",
    parse: (t) => pctNear(t, /buyer'?s (?:premium|commission)/i),
  },
  {
    name: "WineBid",
    // Payment page is cleaner than FAQ (fewer stray percentages)
    url: "https://www.winebid.com/Help/Payment",
    parse: (t) => pctNear(t, /buyer'?s premium/i) ?? firstPct(t),
  },
  {
    name: "iDealwine",
    // Prefer ex-VAT figure (e.g., “21% excluding VAT”)
    url: "https://www.idealwine.com/en/corporate/conditions_generales",
    parse: (t) => {
      const excl = pctNear(t, /(excl|excluding)/i);
      return excl ?? pctNear(t, /buyer'?s premium/i) ?? firstPct(t);
    },
  },
];

async function main() {
  const url = process.env.SUPABASE_URL!;
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  if (!url || !service) throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  const sb = createClient(url, service); // service role bypasses RLS

  const summary: string[] = [];
  let failures = 0;

  for (const h of HOUSES) {
    console.log(`\n=== ${h.name} ===`);
    try {
      // Read current DB row
      const { data: rows, error: selErr } = await sb
        .from("fees")
        .select("id, house, buyers_premium, last_verified, source_url")
        .eq("house", h.name)
        .limit(1);
      if (selErr) throw selErr;
      const current = rows?.[0];
      if (!current) { summary.push(`⚠️ ${h.name}: no DB row`); continue; }
      console.log(`DB → buyers_premium=${current.buyers_premium} last_verified=${current.last_verified}`);

      // Fetch + parse
      const html = await getText(h.url);
      const $ = cheerio.load(html);
      const text = $.text().replace(/\s+/g, " ");
      const scraped = h.parse(text);

      if (scraped == null) {
        console.warn(`Parse FAIL for ${h.name} (first 200 chars: ${text.slice(0,200)}…)`);
        summary.push(`❌ ${h.name}: parse failed`);
        failures++;
        continue;
      }

      console.log(`Scraped → ${scraped * 100}% from ${h.url}`);

      // 🔒 Guardrail: skip updates if outside sane range
      if (!isPlausible(scraped)) {
        console.warn(`Scraped value ${scraped} out of plausible range; skipping update.`);
        summary.push(`🚧 ${h.name}: scraped ${(scraped * 100).toFixed(2)}% out-of-range; no update`);
        failures++;
        continue;
      }

      // Update if changed; otherwise bump last_verified
      if (Math.abs((current.buyers_premium ?? 0) - scraped) > 1e-6) {
        console.log(`Updating ${h.name}: ${current.buyers_premium} → ${scraped}`);
        const { error: updErr } = await sb
          .from("fees")
          .update({ buyers_premium: scraped, last_verified: todayISO(), source_url: h.url })
          .eq("id", current.id);
        if (updErr) throw updErr;
        summary.push(`✏️ ${h.name}: ${current.buyers_premium} → ${scraped}`);
      } else {
        const { error: updErr2 } = await sb
          .from("fees")
          .update({ last_verified: todayISO(), source_url: h.url })
          .eq("id", current.id);
        if (updErr2) throw updErr2;
        console.log(`Unchanged. last_verified bumped to ${todayISO()}`);
        summary.push(`✅ ${h.name}: unchanged at ${scraped}`);
      }
    } catch (e: any) {
      console.error(`🔥 ${h.name} error:`, e?.message ?? e);
      summary.push(`🔥 ${h.name}: ${e?.message ?? "error"}`);
      failures++;
    }
  }

  console.log("\nSummary:\n" + summary.join("\n"));
  await notifySlack(summary);

  if (failures > 0) process.exit(1); // mark Action failed so you see it
}

main().catch(err => { console.error(err); process.exit(1); });
