'use client';
import { useEffect, useState } from 'react';

const FILL = ["Into-Neck", "High-Shoulder", "Mid-Shoulder"] as const;
const CAPSULE = ["Pristine", "Scuffed", "Torn/Seepage"] as const;
const LABEL = ["Pristine", "Bin-Soiled", "Torn"] as const;
const YESNO = ["No","Yes"] as const;
const STORAGE = ["Provenance Known","Unknown/Questionable"] as const;
const DRINK = ["Prime Now","Neutral","Early (Needs Time)","Late (Drink Up)"] as const;

// Minimal destination list (expand anytime)
const COUNTRIES = [
  "US","UK","FR","DE","ES","IT","NL","BE","LU","DK","SE","FI",
  "IE","PT","AT","PL","CZ","HU","RO","BG","HR","SI","SK","GR",
  "EE","LV","LT"
] as const;

type Result = {
  preFeeMax: number;
  maxBid: number;
  riskSum: number;
  drinkAdj: number;
  bp: number;
  tax: number;
  targetDiscount: number;
};

type FeeRow = {
  house: string;
  buyers_premium: number;
  last_verified: string | null;
  source_url?: string | null;
};

export default function BidCapForm() {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Houses from DB
  const [houses, setHouses] = useState<FeeRow[]>([]);
  const [selectedHouse, setSelectedHouse] = useState<string>("");
  const [selectedInfo, setSelectedInfo] = useState<FeeRow | null>(null);

  // Form state (NO buyers_premium here—server will fetch from DB)
  const [state, setState] = useState({
    auction_house: "",
    retail_anchor_usd: 150,
    shipping_usd: 25,
    sales_tax_rate: 0.095,     // used when auto_tax = false
    target_discount: 0.12,

    // NEW: destination tax inputs
    shipping_country: "US" as (typeof COUNTRIES)[number],
    shipping_zip: "",
    auto_tax: false,

    // Risk/condition
    fill_level: "Into-Neck",
    capsule: "Pristine",
    label: "Pristine",
    seepage: "No",
    storage: "Provenance Known",
    mold: "No",
    drinkability: "Neutral",
  });

  useEffect(() => {
    setError(null);
    fetch("/api/fees")
      .then(r => {
        if (!r.ok) throw new Error("Failed to load auction houses.");
        return r.json();
      })
      .then((rows: FeeRow[]) => {
        setHouses(rows);
        if (rows.length) {
          setSelectedHouse(rows[0].house);
          setSelectedInfo(rows[0]);
          setState(s => ({ ...s, auction_house: rows[0].house }));
        } else {
          setError("No auction houses available. Please try again later.");
        }
      })
      .catch(() => setError("Could not load auction houses. Please refresh or try again later."));
  }, []);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setResult(null);
    setError(null);
    try {
      const res = await fetch("/api/compute", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(state),
      });

      if (!res.ok) {
        let msg = "Something went wrong.";
        try {
          const err = await res.json();
          if (err?.error) msg = err.error;
        } catch {}
        setError(msg);
        return;
      }

      const data = await res.json();
      setResult(data);
    } catch (err) {
      console.error(err);
      setError("Network error. Check your connection and try again.");
    } finally {
      setLoading(false);
    }
  }

  function InputRow({ label, children }: { label: string; children: React.ReactNode }) {
    return (
      <div className="grid grid-cols-1 md:grid-cols-3 gap-2 items-center py-2 border-b">
        <div className="font-medium">{label}</div>
        <div className="md:col-span-2">{children}</div>
      </div>
    );
  }

  function ErrorBanner({ message }: { message: string }) {
    return (
      <div className="mb-4 rounded border border-red-300 bg-red-50 p-3 text-sm text-red-700">
        {message}
      </div>
    );
  }

  const num = (v: number) => new Intl.NumberFormat(undefined, { style: 'decimal', maximumFractionDigits: 2 }).format(v);
  const money = (v: number) => new Intl.NumberFormat(undefined, { style: 'currency', currency: 'USD' }).format(v);
  const pct = (v: number) => `${(v*100).toFixed(2)}%`;

  return (
    <form onSubmit={onSubmit} className="max-w-2xl w-full bg-white/60 rounded-xl p-4 shadow">
      <h2 className="text-xl font-semibold mb-4">Bid-Cap + Risk Engine</h2>

      {error && <ErrorBanner message={error} />}

      <InputRow label="Auction House">
        <div>
          <select
            className="w-full border rounded p-2"
            value={selectedHouse}
            onChange={(e) => {
              const v = e.target.value;
              setSelectedHouse(v);
              const info = houses.find(h => h.house === v) ?? null;
              setSelectedInfo(info);
              setState(s => ({ ...s, auction_house: v }));
            }}
            disabled={!houses.length}
          >
            {houses.map(h => <option key={h.house} value={h.house}>{h.house}</option>)}
          </select>

          {selectedHouse && !selectedInfo && (
            <div className="text-xs text-amber-700 bg-amber-50 border border-amber-300 rounded p-2 mt-2">
              Selected house isn’t recognized. Please pick another or refresh.
            </div>
          )}

          {selectedInfo && (
            <div className="text-xs text-gray-600 mt-1">
              Buyer’s Premium: {(selectedInfo.buyers_premium * 100).toFixed(2)}%
              {selectedInfo.last_verified && (
                <> — verified {new Date(selectedInfo.last_verified).toLocaleDateString()}</>
              )}
              {selectedInfo.source_url && (
                <> — <a className="underline" href={selectedInfo.source_url} target="_blank" rel="noreferrer">source</a></>
              )}
            </div>
          )}
        </div>
      </InputRow>

      <InputRow label="Retail Anchor (USD)">
        <input
          type="number"
          step="0.01"
          className="w-full border rounded p-2"
          value={state.retail_anchor_usd}
          onChange={(e) => setState(s => ({...s, retail_anchor_usd: parseFloat(e.target.value)}))}
        />
      </InputRow>

      <InputRow label="Shipping (USD)">
        <input
          type="number"
          step="0.01"
          className="w-full border rounded p-2"
          value={state.shipping_usd}
          onChange={(e) => setState(s => ({...s, shipping_usd: parseFloat(e.target.value)}))}
        />
      </InputRow>

      {/* NEW: Destination country */}
      <InputRow label="Ship Country">
        <select
          className="w-full border rounded p-2"
          value={state.shipping_country}
          onChange={(e) => setState(s => ({...s, shipping_country: e.target.value as typeof s.shipping_country}))}
        >
          {COUNTRIES.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
      </InputRow>

      {/* NEW: ZIP / Postal */}
      <InputRow label="Ship ZIP / Postal">
        <input
          className="w-full border rounded p-2"
          value={state.shipping_zip}
          onChange={(e) => setState(s => ({...s, shipping_zip: e.target.value}))}
          placeholder={state.shipping_country === "US" ? "e.g., 94105" : "e.g., W1A 1AA"}
        />
      </InputRow>

      {/* NEW: Auto Tax toggle */}
      <InputRow label="Auto Tax (beta)">
        <div className="flex items-center gap-3">
          <input
            id="auto-tax"
            type="checkbox"
            checked={state.auto_tax}
            onChange={(e) => setState(s => ({...s, auto_tax: e.target.checked}))}
          />
          <label htmlFor="auto-tax" className="text-sm text-gray-700">
            If on, we’ll choose VAT vs. US sales tax based on the destination country.
          </label>
        </div>
      </InputRow>

      <InputRow label="Sales Tax (decimal)">
        <div>
          <input
            type="number"
            step="0.0001"
            className="w-full border rounded p-2 disabled:bg-gray-100 disabled:text-gray-500"
            value={state.sales_tax_rate}
            disabled={state.auto_tax}
            onChange={(e) => setState(s => ({...s, sales_tax_rate: parseFloat(e.target.value)}))}
          />
          <p className="text-xs text-gray-500 mt-1">
            {state.auto_tax
              ? "Auto Tax is on: this field is ignored."
              : "Enter your local sales tax as a decimal, e.g., 0.095 for 9.5%."}
          </p>
        </div>
      </InputRow>

      <InputRow label="Target Discount (decimal)">
        <input
          type="number"
          step="0.0001"
          className="w-full border rounded p-2"
          value={state.target_discount}
          onChange={(e) => setState(s => ({...s, target_discount: parseFloat(e.target.value)}))}
        />
      </InputRow>

      <h3 className="text-lg font-semibold mt-4">Condition & Drinkability</h3>

      <InputRow label="Fill Level">
        <select
          className="w-full border rounded p-2"
          value={state.fill_level}
          onChange={(e) => setState(s => ({...s, fill_level: e.target.value}))}
        >
          {FILL.map(v => <option key={v} value={v}>{v}</option>)}
        </select>
      </InputRow>

      <InputRow label="Capsule">
        <select
          className="w-full border rounded p-2"
          value={state.capsule}
          onChange={(e) => setState(s => ({...s, capsule: e.target.value}))}
        >
          {CAPSULE.map(v => <option key={v} value={v}>{v}</option>)}
        </select>
      </InputRow>

      <InputRow label="Label">
        <select
          className="w-full border rounded p-2"
          value={state.label}
          onChange={(e) => setState(s => ({...s, label: e.target.value}))}
        >
          {LABEL.map(v => <option key={v} value={v}>{v}</option>)}
        </select>
      </InputRow>

      <InputRow label="Seepage">
        <select
          className="w-full border rounded p-2"
          value={state.seepage}
          onChange={(e) => setState(s => ({...s, seepage: e.target.value}))}
        >
          {YESNO.map(v => <option key={v} value={v}>{v}</option>)}
        </select>
      </InputRow>

      <InputRow label="Storage">
        <select
          className="w-full border rounded p-2"
          value={state.storage}
          onChange={(e) => setState(s => ({...s, storage: e.target.value}))}
        >
          {STORAGE.map(v => <option key={v} value={v}>{v}</option>)}
        </select>
      </InputRow>

      <InputRow label="Mold">
        <select
          className="w-full border rounded p-2"
          value={state.mold}
          onChange={(e) => setState(s => ({...s, mold: e.target.value}))}
        >
          {YESNO.map(v => <option key={v} value={v}>{v}</option>)}
        </select>
      </InputRow>

      <InputRow label="Drinkability">
        <select
          className="w-full border rounded p-2"
          value={state.drinkability}
          onChange={(e) => setState(s => ({...s, drinkability: e.target.value}))}
        >
          {DRINK.map(v => <option key={v} value={v}>{v}</option>)}
        </select>
      </InputRow>

      <button
        disabled={loading || !houses.length}
        className="mt-4 px-4 py-2 rounded bg-black text-white disabled:opacity-50"
      >
        {loading ? "Calculating..." : "Compute Max Bid"}
      </button>

      {result && (
        <div className="mt-6 p-4 border rounded bg-gray-50">
          <h4 className="font-semibold mb-2">Result</h4>
          <div>Pre-Fee Max: <strong>{money(result.preFeeMax)}</strong></div>
          <div>Max Bid: <strong>{money(result.maxBid)}</strong></div>
          <div className="mt-2 text-sm text-gray-700">
            <div>Risk Sum: {pct(result.riskSum)} | Drink Adj: {num(result.drinkAdj)}</div>
            <div>Buyer’s Premium: {pct(result.bp)} | Sales Tax: {pct(result.tax)} | Target Discount: {pct(result.targetDiscount)}</div>
          </div>
        </div>
      )}
    </form>
  );
}

// helpers
function num(v: number) {
  return new Intl.NumberFormat(undefined, { style: 'decimal', maximumFractionDigits: 2 }).format(v);
}
function money(v: number) {
  return new Intl.NumberFormat(undefined, { style: 'currency', currency: 'USD' }).format(v);
}
function pct(v: number) {
  return `${(v*100).toFixed(2)}%`;
}
