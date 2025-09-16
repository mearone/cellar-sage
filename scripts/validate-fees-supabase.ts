// @ts-nocheck
// scripts/validate-fees-supabase.ts

import { createClient } from '@supabase/supabase-js';
import * as cheerio from 'cheerio';
import { request } from 'undici';

// Define what to check
const HOUSES = [
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
    regex: /buyer'?s premium[^\d%]*([0-2]?\d)\s?%/i,
  },
  {
    name: "iDealwine",
    url: "https://www.idealwine.com/uk/auctions/rules-and-terms.jsp",
    regex: /buyer'?s premium[^\d%]*([0-2]?\d)\s?%/i,
  },
];

async function main() {
  const sb = createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  for (const h of HOUSES) {
    console.log(`Checking ${h.name}…`);
    try {
      const res = await request(h.url);
      const html = await res.body.text();
      const $ = cheerio.load(html);
      const text = $.text();

      const m = text.match(h.regex);
      if (!m) {
        console.warn(`❌ Could not parse ${h.name}`);
        continue;
      }

      const pct = parseFloat(m[1]) / 100;
      console.log(`Found ${h.name} premium: ${pct}`);

      // Update Supabase
      const { error } = await sb
        .from("fees")
        .update({
          buyers_premium: pct,
          last_verified: new Date().toISOString().slice(0, 10),
          source_url: h.url,
        })
        .eq("house", h.name);

      if (error) console.error(error);
    } catch (err) {
      console.error(`Error fetching ${h.name}:`, err);
    }
  }
}

main();
