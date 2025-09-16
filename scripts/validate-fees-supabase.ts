// @ts-nocheck
// scripts/validate-fees-supabase.ts
import { createClient } from '@supabase/supabase-js';
import { request } from 'undici';
import * as cheerio from 'cheerio';

type House = { name: string; url: string; regex: RegExp };

const HOUSES: House[] = [
  {
    name: "Acker",
    url: "https://www.ackerwines.com/terms-and-conditions/",
    regex: /buyer'?s premium[^\d%]*([12][0-9])\s?%/i,
  },
  {
    name: "Spectrum",
    url: "https://www.spectrumwine.com/terms",
    regex: /buyer'?s premium[^\d%]*([12][0-9])\s?%/i,
  },
  {
    name: "WineBid",
    url: "https://www.winebid.com/Help/Policies",
    regex: /buyer'?s premium[^\d%]*([01]?\d|2[0-9])\s?%/i,
  },
  {
    name: "iDealwine",
    url: "https://www.idealwine.com/uk/auctions/rules-and-terms.jsp",
    regex: /buyer'?s premium[^\d%]*([01]?\d|2[0-9])\s?%/i,
  },
];

function todayISO() { return new Date().toISOString().slice(0,10); }

async function fetchText(url: string): Promise<string> {
  const res = await request(url, {
    headers: {
      // look like a normal browser
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml',
      'Accept-Language': 'en-US,en;q=0.9',
    },
    maxRedirections: 3,
  });
  if (res.statusCode >= 400) {
    throw new Error(`HTTP ${res.statusCode}`);
  }
  return await res.body.text();
}

async function notifySlack(lines: string[]) {
  const hook = process.env.SLACK_WEBHOOK_URL;
  if (!hook) return;
  // Use undici fetch-like
  await request(hook, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: Buffer.from(JSON.stringify({ text: "🍷 Fee validator report\n" + lines.join("\n") })),
  });
}

async function main() {
  const url = process.env.SUPABASE_URL!;
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  if (!url || !service) {
    console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
    process.exit(1);
  }
  const sb = createClient(url, service); // service role bypasses RLS

  const summary: string[] = [];
  let failures = 0;

  for (const h of HOUSES) {
    console.log(`\n=== ${h.name} ===`);
    try {
      // 1) Get current DB value
      const { data: rows, error: selErr } = await sb
        .from('fees')
        .select('id, house, buyers_premium, last_verified, source_url')
        .eq('house', h.name)
        .limit(1);
      if (selErr) throw selErr;
      const current = rows?.[0];
      if (!current) {
        console.warn(`No DB row found for ${h.name} — skipping update.`);
        summary.push(`⚠️ ${h.name}: no DB row`);
        continue;
      }
      console.log(`DB → buyers_premium=${current.buyers_premium} last_verified=${current.last_verified}`);

      // 2) Fetch and parse site
      const html = await fetchText(h.url);
      const $ = cheerio.load(html);
      const text = $.text().replace(/\s+/g, ' ');
      const match = text.match(h.regex);

      if (!match) {
        console.warn(`Parse FAIL for ${h.name}. First 200 chars of text: ${text.slice(0,200)}…`);
        summary.push(`❌ ${h.name}: parse failed`);
        failures++;
        continue;
      }

      const pct = parseFloat(match[1]);
      if (Number.isNaN(pct)) {
        console.warn(`Parse produced NaN for ${h.name}: match[1]=${match[1]}`);
        summary.push(`❌ ${h.name}: parse NaN`);
        failures++;
        continue;
      }
      const scraped = pct / 100;
      console.log(`Scraped → ${pct}% (= ${scraped}) from ${h.url}`);

      // 3) Compare + maybe update
      if (Math.abs((current.buyers_premium ?? 0) - scraped) > 1e-6) {
        console.log(`Updating ${h.name}: ${current.buyers_premium} → ${scraped}`);
        const { data: upd, error: updErr } = await sb
          .from('fees')
          .update({
            buyers_premium: scraped,
            last_verified: todayISO(),
            source_url: h.url,
          })
          .eq('id', current.id)
          .select('*');
        if (updErr) throw updErr;
        console.log(`Rows updated: ${upd?.length ?? 0}`);
        summary.push(`✏️ ${h.name}: ${current.buyers_premium} → ${scraped}`);
      } else {
        // Even if unchanged, refresh the last_verified to show we checked today
        const { data: upd2, error: updErr2 } = await sb
          .from('fees')
          .update({ last_verified: todayISO(), source_url: h.url })
          .eq('id', current.id)
          .select('id,last_verified');
        if (updErr2) throw updErr2;
        console.log(`Unchanged. last_verified bumped to ${todayISO()}`);
        summary.push(`✅ ${h.name}: unchanged at ${scraped}`);
      }
    } catch (e: any) {
      console.error(`🔥 ${h.name} error:`, e?.message ?? e);
      summary.push(`🔥 ${h.name}: ${e?.message ?? 'error'}`);
      failures++;
    }
  }

  console.log("\nSummary:\n" + summary.join("\n"));
  await notifySlack(summary);

  if (failures > 0) {
    // non-zero exit so you notice in Actions UI
    process.exit(1);
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
