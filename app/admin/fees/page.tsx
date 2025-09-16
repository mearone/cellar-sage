'use client';
import { useEffect, useState } from "react";

type Row = { house: string; buyers_premium: number; last_verified: string | null; source_url?: string | null };

export default function AdminFeesPage() {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setErr(null);
    try {
      const r = await fetch("/api/fees");
      if (!r.ok) throw new Error("Failed to load fees");
      const data = await r.json();
      setRows(data);
    } catch (e:any) {
      setErr(e.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  async function save(row: Row) {
    setMsg(null); setErr(null);
    try {
      const r = await fetch("/api/admin/fees", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          house: row.house,
          buyers_premium: Number(row.buyers_premium),
          source_url: row.source_url || null,
          last_verified: row.last_verified || null,
        }),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(data?.error || "Save failed");
      setMsg(`Saved ${row.house}`);
      await load();
    } catch (e:any) {
      setErr(e.message);
    }
  }

  function onChange(i: number, patch: Partial<Row>) {
    setRows((prev) => {
      const copy = [...prev];
      copy[i] = { ...copy[i], ...patch };
      return copy;
    });
  }

  return (
    <div className="max-w-3xl mx-auto p-6">
      <h1 className="text-2xl font-semibold mb-4">Admin: Fees</h1>

      {loading && <div>Loading…</div>}
      {err && <div className="mb-3 rounded border border-red-300 bg-red-50 p-3 text-sm text-red-700">{err}</div>}
      {msg && <div className="mb-3 rounded border border-emerald-300 bg-emerald-50 p-3 text-sm text-emerald-700">{msg}</div>}

      {!loading && !rows.length && <div>No rows.</div>}

      {!!rows.length && (
        <div className="overflow-x-auto border rounded">
          <table className="min-w-full text-sm">
            <thead className="bg-gray-100">
              <tr>
                <th className="text-left p-2">House</th>
                <th className="text-left p-2">Buyer’s Premium (decimal)</th>
                <th className="text-left p-2">Last Verified</th>
                <th className="text-left p-2">Source URL</th>
                <th className="p-2">Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={r.house} className="border-t">
                  <td className="p-2 font-medium">{r.house}</td>
                  <td className="p-2">
                    <input
                      type="number"
                      step="0.0001"
                      className="border rounded px-2 py-1 w-32"
                      value={r.buyers_premium}
                      onChange={(e) => onChange(i, { buyers_premium: parseFloat(e.target.value) })}
                    />
                  </td>
                  <td className="p-2">
                    <input
                      type="date"
                      className="border rounded px-2 py-1"
                      value={r.last_verified ? r.last_verified.slice(0,10) : ""}
                      onChange={(e) => onChange(i, { last_verified: e.target.value })}
                    />
                  </td>
                  <td className="p-2">
                    <input
                      type="url"
                      className="border rounded px-2 py-1 w-72"
                      placeholder="https://…"
                      value={r.source_url || ""}
                      onChange={(e) => onChange(i, { source_url: e.target.value })}
                    />
                  </td>
                  <td className="p-2">
                    <button className="px-3 py-1 rounded bg-black text-white" onClick={() => save(rows[i])}>
                      Save
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="text-xs text-gray-500 mt-3">
        Changes are audited in <code>fees_audit</code>. This page is protected by Basic Auth.
      </p>
    </div>
  );
}
