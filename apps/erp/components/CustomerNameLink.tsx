"use client";

import { useState } from "react";
import { CustomerDetailDialog } from "@/components/CustomerDetailDialog";
import { CustomerSummaryLine } from "@/components/CustomerSummaryLine";
import type { CustomerSummary } from "@/lib/customer-summary";

// Turns a plain "sold to <customer_name>" snapshot into a clickable link that opens
// the full customer profile (view + Edit Customer) -- view-only otherwise (no
// "Change Customer" reassign here; that's the Sales Ledger's CustomerCell's job,
// since reassigning which customer a sale belongs to is a sales-record action, not
// a stock-view one). Reused anywhere a sale/asset row shows a customer_name snapshot
// alongside the customer_id it came from (Stock's Sold tab, Sold Accessories tab).
// `summary` renders a small type/contact/address/source subtitle inline (see
// lib/customer-summary.ts) so staff can tell same-named customers apart at a glance,
// without needing to click through.
export function CustomerNameLink({
  customerId,
  customerName,
  summary,
  onUpdated,
  className,
}: {
  customerId: string | null | undefined;
  customerName: string | null | undefined;
  summary?: CustomerSummary | null;
  onUpdated?: () => void;
  className?: string;
}) {
  const [showDetail, setShowDetail] = useState(false);
  if (!customerId) return <>{customerName || "—"}</>;
  return (
    <>
      <button
        type="button"
        onClick={() => setShowDetail(true)}
        className={className || "text-primary underline text-left"}
      >
        {customerName || "—"}
      </button>
      <CustomerSummaryLine summary={summary} />
      {showDetail && (
        <CustomerDetailDialog
          customerId={customerId}
          onClose={() => setShowDetail(false)}
          onCustomerUpdated={onUpdated}
        />
      )}
    </>
  );
}
