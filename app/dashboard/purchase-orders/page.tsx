'use client';

import AddPurchaseOrder from '@/components/AddPurchaseOrder';

export default function PurchaseOrdersPage() {
  return (
    <div>
      <h1 className="text-2xl font-bold mb-4">Create New Purchase Order</h1>
      <AddPurchaseOrder />
    </div>
  );
}