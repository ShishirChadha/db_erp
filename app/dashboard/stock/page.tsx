'use client'

import StockView from '@/components/StockView'
import RequireOwner from '@/components/RequireOwner'

// Main-ERP stock view -- the historical/legacy/PO-sourced data you're reconciling by
// hand. Deliberately excludes anything from the new interim employee-entry system (see
// /dashboard/live-stock) so the two never show mixed together until you connect them.
function MainStockPage() {
  return (
    <StockView
      title="Stock (Main ERP)"
      subtitle="Historical and PO-tracked stock. New employee-entered stock lives separately in Live Stock until you're ready to connect it."
      sourceMode="exclude_employee_intake"
    />
  )
}

export default function MainStockPageGuarded() {
  return (
    <RequireOwner>
      <MainStockPage />
    </RequireOwner>
  )
}
