'use client'

import StockView from '@/components/StockView'
import RequirePageAccess from '@/components/RequirePageAccess'

// Main-ERP stock view -- the historical/legacy/PO-sourced data you're reconciling by
// hand. Deliberately excludes anything from the new interim employee-entry system (see
// /dashboard/live-stock) so the two never show mixed together until you connect them.
// View/edit access is gated by the 'stock' page key -- cost/vendor/PO visibility and
// destructive/financial actions (delete, PO creation, invoice generation) stay
// isOwner-only regardless of any edit grant, same pattern as Live Stock/Sales.
function MainStockPage() {
  return (
    <StockView
      title="Stock (Main ERP)"
      subtitle="Historical and PO-tracked stock. New employee-entered stock lives separately in Live Stock until you're ready to connect it."
      sourceMode="exclude_employee_intake"
      pageKey="stock"
    />
  )
}

export default function MainStockPageGuarded() {
  return (
    <RequirePageAccess pageKey="stock">
      <MainStockPage />
    </RequirePageAccess>
  )
}
