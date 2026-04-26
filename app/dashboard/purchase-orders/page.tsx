'use client';

import { useState } from 'react';
import AddPurchaseOrder from '@/components/AddPurchaseOrder';
import PurchaseOrderList from '@/components/PurchaseOrderList';

export default function PurchaseOrdersPage() {
  const [showForm, setShowForm] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-2xl font-bold">Purchase Orders</h1>
        <button
          onClick={() => setShowForm(!showForm)}
          className="rounded-md bg-blue-600 px-4 py-2 text-sm text-white hover:bg-blue-700"
        >
          {showForm ? 'Cancel' : '+ New Purchase Order'}
        </button>
      </div>

      {showForm && (
        <div className="mb-6">
          <AddPurchaseOrder
            onSuccess={() => {
              setShowForm(false);
              setRefreshKey((k) => k + 1);
            }}
          />
        </div>
      )}

      <PurchaseOrderList refreshKey={refreshKey} />
    </div>
  );
}