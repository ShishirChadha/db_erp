'use client'

import StockView from '@/components/StockView'

// Employee-facing interim view -- only stock entered through the new Stock Intake /
// Sell flow (source='employee_intake'). Kept separate from the main ERP's Stock page
// (historical/legacy/PO data) so the two never mix until deliberately connected.
export default function LiveStockPage() {
  return (
    <StockView
      title="Live Stock"
      subtitle="Stock entered through Stock Intake and Sell. Always up to date for checking what's available or confirming a sale/warranty."
      sourceMode="employee_intake"
      showServiceActions
    />
  )
}
