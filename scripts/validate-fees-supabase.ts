// @ts-nocheck
import { createClient } from '@supabase/supabase-js';
import * as cheerio from 'cheerio';

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

type House = {
  name: string;
  url: string;
  // A function lets us tailor parsing per house (ex-VAT, decimals, etc.)
  parse: (text: string) => number | null; // returns decimal (e.g., 0.25)
};

const HOUSES: House[] = [
  {
    name: "Acker",
    url: "https://www.ackerwines.com/terms-conditions/",
    parse: (t) => captureFirstPct(t, /buyer'?s premium/i),
  },
  {
    name: "Spectrum",
    url: "https://www.spectrumwine.com/auctions/terms.aspx",
    parse: (t) => captureFirstPct(t, /buyer'?s premium|buyer'?s commission/i),
  },
  {
    name: "WineBid",
    // “A 17% buyer’s premium is added …”
    url: "https://www.winebid.com/FrequentlyAskedQuestions",
    parse: (t) => captureFirstPct(t, /buyer'?s premium/i),
  },
  {
    name: "iDealwine",
    // “25.2% incl. VAT (21% excl. VAT)”; we want the ex-VAT 21%
    url: "https://www.idealwine.com/en/corporate/conditions_generales",
    parse: (t) => {
      // Prefer an “excl” match (21%), else first percent
      const excl = matchPct(t, /(\d{1,2}(?:\.\d)?)\s?%\s*(?:excl|excluding)/i);
      if (excl != null) return excl;
      return captureFirstPct(t); // fallback
    },
  },
];

// ----- helpers -----
function todayISO() { return new Date().toISOString().slice(0,10); }

function matchPct(text: string, re: RegExp): number | null {
  const m = text.match(re);
  if (!m) return null;
  const pct = parseFloat(m[1]);
  if (Number.isNaN(pct)) return null;
  return pct / 100;
}

function captureFirstPct(text: string, contextRe?: RegExp): number | null {
  // If a context regex is provided, slice around it to bias the first pct nearby
  let hay = text;
  if (contextRe) {
    const c = text.search(contextRe);
    if (c >= 0) hay = text.slice(Math.max(0, c - 200), c + 400);
  }
  const m = hay.match(/(\d{1,2}(?:\.\d)?)\s?%/);
  if (!m) return null;
  const pct = parseFloat(m[1]);
  if (Number.isNaN(pct)) return null;
  return pct / 100;
}

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
  } catch (e: any) {
    // Fallback when blocked or URL changes return 40x/50x
    return await fetchViaZenRows(url);
  }
}

async function notifySlack(lines: string[]) {
  const hook = process.env.SLACK_WEBHOOK_URL;
  if (!hook) return;
  await fetch(hook, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text: "🍷 Fee validator report\n" + lines.join("\n") }),
  }).catch(() => {});
}

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
      const { data: rows, error: selErr } = await sb
        .from("fees")
        .select("id, house, buyers_premium, last_verified, source_url")
        .eq("house", h.name)
        .limit(1);
      if (selErr) throw selErr;
      const current = rows?.[0];
      if (!current) { summary.push(`⚠️ ${h.name}: no DB row`); continue; }
      console.log(`DB → buyers_premium=${current.buyers_premium} last_verified=${current.last_verified}`);

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
  if (failures > 0) process.exit(1);
}

main().catch(err => { console.error(err); process.exit(1); });
