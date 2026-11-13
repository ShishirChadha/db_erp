"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Loader2 } from "lucide-react";
import { apiFetch } from "@/lib/api-client";
import { StatusBadge } from "@/components/StatusBadge";
import { cn } from "@/lib/utils";

// What references this customer (GET /api/customers/[id]/activity): sale and
// invoice counts that open the Sales Ledger filtered to this customer, the
// invoice numbers and sale IDs themselves, and the other linked records -- so
// a junk/duplicate customer can be spotted before it's deleted. Shared by the
// Customers page detail pane and CustomerDetailDialog.

interface Activity {
  sales: {
    count: number;
    voided: number;
    list: { id: string; sale_date: string; invoice_number: string | null; invoice_id: string | null; item: string | null; sale_total: number | null }[];
  };
  invoices: {
    count: number;
    list: { id: string; invoice_number: string; invoice_date: string; invoice_type: string | null; status: string | null; grand_total: number | null }[];
  };
  other: { repair_jobs: number; replacement_jobs: number; quotations: number; rentals: number };
}

const SALES_PREVIEW = 10;
const money = (n: number | null) =>
  n == null ? "—" : `₹${Number(n).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
const date = (d: string) =>
  new Date(d).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });

function StatTile({ label, value, href, sub }: { label: string; value: number; href?: string; sub?: string }) {
  const body = (
    <>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={cn("text-xl font-semibold tabular-nums", href && "text-primary")}>{value}</div>
      {sub && <div className="text-[11px] text-muted-foreground">{sub}</div>}
    </>
  );
  return href && value > 0 ? (
    <Link href={href} className="rounded-md border p-2.5 transition-colors hover:bg-muted/60" title="Open in Sales Ledger, filtered to this customer">
      {body}
    </Link>
  ) : (
    <div className="rounded-md border p-2.5">{body}</div>
  );
}

export default function CustomerActivity({ customerId }: { customerId: string }) {
  const [data, setData] = useState<Activity | null>(null);
  const [error, setError] = useState("");
  const [showAllSales, setShowAllSales] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setData(null);
    setError("");
    setShowAllSales(false);
    apiFetch(`/api/customers/${customerId}/activity`)
      .then(async (res) => {
        const body = await res.json();
        if (cancelled) return;
        if (!res.ok) setError(body.error || "Couldn't load this customer's activity.");
        else setData(body);
      })
      .catch(() => !cancelled && setError("Couldn't load this customer's activity."));
    return () => { cancelled = true; };
  }, [customerId]);

  if (error) return <p className="text-sm text-destructive">{error}</p>;
  if (!data) {
    return (
      <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
        <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading sales and invoices…
      </p>
    );
  }

  const ledgerHref = `/dashboard/sales?customer=${customerId}`;
  const otherTotal = data.other.repair_jobs + data.other.replacement_jobs + data.other.quotations + data.other.rentals;
  const unused = data.sales.count === 0 && data.sales.voided === 0 && data.invoices.count === 0 && otherTotal === 0;
  const otherParts = [
    data.other.repair_jobs && `${data.other.repair_jobs} repair`,
    data.other.replacement_jobs && `${data.other.replacement_jobs} replacement`,
    data.other.quotations && `${data.other.quotations} quotation/PI`,
    data.other.rentals && `${data.other.rentals} rental`,
  ].filter(Boolean) as string[];

  // ERP invoice rows link to their page; numbers that exist only on a sale
  // (recorded Zoho invoices) are listed plain.
  const erpInvoiceIds = new Map(data.invoices.list.map((i) => [i.invoice_number, i.id]));
  const allInvoiceNumbers = Array.from(new Set([
    ...data.invoices.list.map((i) => i.invoice_number),
    ...data.sales.list.map((s) => s.invoice_number).filter((n): n is string => !!n),
  ]));
  const sales = showAllSales ? data.sales.list : data.sales.list.slice(0, SALES_PREVIEW);

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-3 gap-2">
        <StatTile label="Sales" value={data.sales.count} href={ledgerHref} sub={data.sales.voided ? `+${data.sales.voided} voided` : undefined} />
        <StatTile label="Invoices" value={data.invoices.count} href={ledgerHref} />
        <StatTile label="Other records" value={otherTotal} sub={otherParts.join(", ") || undefined} />
      </div>

      {unused ? (
        <StatusBadge tone="warning" className="normal-case">No sales, invoices or other records: likely safe to delete</StatusBadge>
      ) : data.sales.count === 0 && data.invoices.count === 0 ? (
        <p className="text-xs text-muted-foreground">
          No active sales or invoices{data.sales.voided ? `, but ${data.sales.voided} voided sale(s)` : ""}
          {otherParts.length ? ` and ${otherParts.join(", ")}` : ""} still reference this customer.
        </p>
      ) : null}

      {allInvoiceNumbers.length > 0 && (
        <div>
          <div className="mb-1 text-xs text-muted-foreground">Invoice numbers</div>
          <div className="flex flex-wrap gap-1.5">
            {allInvoiceNumbers.map((n) => {
              const id = erpInvoiceIds.get(n);
              return id ? (
                <Link key={n} href={`/dashboard/invoices/${id}`} className="rounded border px-1.5 py-0.5 font-mono text-xs text-primary hover:bg-muted/60">{n}</Link>
              ) : (
                <span key={n} className="rounded border px-1.5 py-0.5 font-mono text-xs" title="Recorded on the sale (no ERP invoice record)">{n}</span>
              );
            })}
          </div>
        </div>
      )}

      {data.sales.list.length > 0 && (
        <div>
          <div className="mb-1 text-xs text-muted-foreground">Sales</div>
          <ul className="divide-y rounded-md border text-xs">
            {sales.map((s) => (
              <li key={s.id} className="grid grid-cols-[auto_1fr_auto] items-start gap-x-3 gap-y-0.5 px-2.5 py-1.5">
                <span className="text-muted-foreground tabular-nums">{date(s.sale_date)}</span>
                <span className="min-w-0">
                  <span className="block truncate">{s.item || "—"}</span>
                  <span className="text-muted-foreground">
                    Sale ID <span className="font-mono" title={s.id}>{s.id.slice(0, 8)}</span>
                    {" · "}
                    {s.invoice_number ? <>Invoice <span className="font-mono">{s.invoice_number}</span></> : "Not invoiced"}
                  </span>
                </span>
                <span className="text-right tabular-nums">{money(s.sale_total)}</span>
              </li>
            ))}
          </ul>
          <div className="mt-1 flex items-center justify-between text-xs">
            {data.sales.list.length > SALES_PREVIEW ? (
              <button type="button" className="text-primary hover:underline" onClick={() => setShowAllSales((v) => !v)}>
                {showAllSales ? "Show fewer" : `Show all ${data.sales.list.length}`}
              </button>
            ) : <span />}
            <Link href={ledgerHref} className="text-primary hover:underline">Open in Sales Ledger →</Link>
          </div>
        </div>
      )}
    </div>
  );
}
