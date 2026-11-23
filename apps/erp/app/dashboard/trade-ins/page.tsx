"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { apiFetch } from "@/lib/api-client";
import { useRole } from "@/lib/auth/useRole";
import RequirePageAccess from "@/components/RequirePageAccess";
import { Pagination } from "@/components/Pagination";
import { ErrorBanner } from "@/components/ErrorBanner";
import { ReasonConfirmDialog } from "@/components/ReasonConfirmDialog";
import { StatusBadge } from "@/components/StatusBadge";
import { Checkbox } from "@/components/ui/checkbox";

// Every customer laptop taken back as part-payment on a sale (upgrades). Values
// are what we paid for each one, so this list is its own page grant. A
// trade-in is taken from the sale itself (Sales Ledger, or straight after a sale
// on the Sell form); this page is for looking back, the buyback slip, and the
// owner's undo. Stacked rows, no wide table (owner preference).

const PAGE_SIZE = 25;
const rupees = (n: number) => `₹${(Math.round(Number(n) * 100) / 100).toLocaleString("en-IN")}`;

function TradeInsPage() {
  const { isOwner } = useRole();
  const [rows, setRows] = useState<any[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [showVoid, setShowVoid] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [undoing, setUndoing] = useState<any | null>(null);
  const [undoError, setUndoError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    const res = await apiFetch(`/api/trade-ins?page=${page}&limit=${PAGE_SIZE}${showVoid ? "&include_void=true" : ""}`);
    if (!res.ok) {
      setError((await res.json().catch(() => ({}))).error || "Could not load trade-ins.");
    } else {
      const json = await res.json();
      setRows(json.data || []);
      setTotal(json.total || 0);
    }
    setLoading(false);
  }, [page, showVoid]);
  useEffect(() => { load(); }, [load]);

  const undo = async (reason: string) => {
    setUndoError("");
    const res = await apiFetch(`/api/trade-ins/${undoing.id}`, { method: "DELETE", body: JSON.stringify({ reason }) });
    if (!res.ok) {
      setUndoError((await res.json().catch(() => ({}))).error || "Could not undo.");
      return;
    }
    setUndoing(null);
    load();
  };

  return (
    <div className="max-w-4xl">
      <h1 className="text-2xl font-bold mb-1">Trade-ins</h1>
      <p className="text-sm text-muted-foreground mb-4">
        Old laptops customers gave us as part-payment on an upgrade. Each one is back in stock with its trade-in value as its cost, and the value is recorded on the new sale as a &quot;Trade-in&quot; payment. To take a new one, open the sale in the Sales Ledger.
      </p>
      <label className="flex items-center gap-2 text-sm mb-3 w-fit">
        <Checkbox checked={showVoid} onCheckedChange={(v) => { setShowVoid(!!v); setPage(1); }} />
        Show undone trade-ins
      </label>
      {error && <ErrorBanner message={error} onRetry={load} />}

      <div className="rounded-md border divide-y">
        {loading && rows.length === 0 && <div className="p-4 text-sm text-muted-foreground">Loading…</div>}
        {!loading && rows.length === 0 && <div className="p-4 text-sm text-center text-muted-foreground">No trade-ins yet.</div>}
        {rows.map((t, i) => {
          const unit = t.asset?.sku_master?.sku_description || "Old unit";
          const against = t.sale?.unit ? `${t.sale.unit.description || "unit"} (${t.sale.unit.serial_number})` : "an accessory sale";
          return (
            <div key={t.id} className={`p-3 text-sm ${t.voided_at ? "opacity-60" : ""}`}>
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <span className="font-medium">
                  <span className="text-muted-foreground tabular-nums mr-2">{(page - 1) * PAGE_SIZE + i + 1}.</span>
                  {t.trade_in_date} · {t.trade_in_number}
                </span>
                <span className="flex items-center gap-2">
                  <span className="tabular-nums font-medium">{rupees(t.value)}</span>
                  <span className="text-muted-foreground">{t.payment_account}</span>
                  {t.voided_at && <StatusBadge tone="danger">Undone</StatusBadge>}
                </span>
              </div>
              <div className="mt-1">
                {t.customers?.customer_name || "Customer"}: {unit} <span className="text-muted-foreground">({t.asset?.serial_number})</span>
                <span className="text-muted-foreground"> · {t.was_our_unit ? "we sold it earlier" : "new to us"}{t.asset?.status ? ` · now ${t.asset.status.replace(/_/g, " ")}` : ""}</span>
              </div>
              <div className="text-xs text-muted-foreground mt-0.5">
                Against {against}{t.sale?.sale_total != null ? `, sale ${rupees(t.sale.sale_total)}` : ""}
                {t.accessories_included ? ` · came with ${t.accessories_included}` : ""}
                {t.condition_notes ? ` · ${t.condition_notes}` : ""}
                {t.entered?.full_name ? ` · by ${t.entered.full_name}` : ""}
                {t.voided_at ? ` · undone: ${t.void_reason}` : ""}
              </div>
              <div className="flex gap-3 mt-1 text-xs">
                <Link href={`/dashboard/trade-ins/${t.id}/slip`} target="_blank" className="text-primary underline">Buyback slip</Link>
                {t.sale_id && <Link href={`/dashboard/sales?q=${encodeURIComponent(t.customers?.customer_name || "")}`} className="text-primary underline">Sale</Link>}
                {isOwner && !t.voided_at && (
                  <button type="button" className="text-destructive underline" onClick={() => { setUndoError(""); setUndoing(t); }}>Undo</button>
                )}
              </div>
            </div>
          );
        })}
      </div>
      {total > PAGE_SIZE && <div className="mt-3"><Pagination page={page} pageSize={PAGE_SIZE} total={total} onPageChange={setPage} /></div>}

      {undoing && (
        <ReasonConfirmDialog
          open
          onOpenChange={(o) => !o && setUndoing(null)}
          title={`Undo ${undoing.trade_in_number}?`}
          description={`The ${rupees(undoing.value)} trade-in payment comes off the sale, and ${undoing.asset?.serial_number} ${undoing.was_our_unit ? "goes back to sold (to the customer)" : "leaves stock"}. Only possible while the laptop is still with us and hasn't been sold again.`}
          confirmLabel="Undo trade-in"
          error={undoError}
          onConfirm={undo}
        />
      )}
    </div>
  );
}

export default function TradeInsPageGuarded() {
  return (
    <RequirePageAccess pageKey="trade_ins">
      <TradeInsPage />
    </RequirePageAccess>
  );
}
