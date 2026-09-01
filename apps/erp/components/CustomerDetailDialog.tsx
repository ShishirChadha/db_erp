"use client";

import { useState, useEffect } from "react";
import { createClient } from "@/lib/supabase/client";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Loader2 } from "lucide-react";
import EditCustomerDialog from "@/components/EditCustomerDialog";
import { SearchableCustomerSelect } from "@/components/SearchableCustomerSelect";
import AddCustomerDialog from "@/components/AddCustomerDialog";

interface Customer {
  id: string;
  customer_name: string;
  type: string;
  has_gst: boolean;
  gst_number: string;
  address: string;
  phone: string;
  email: string;
  source: string;
  google_review: boolean;
  social_following: string;
  state?: string;
  state_code?: string;
  created_at?: string;
}

const Field = ({ label, value }: { label: string; value: React.ReactNode }) => (
  <div>
    <div className="text-xs text-muted-foreground">{label}</div>
    <div className="text-sm">{value || "—"}</div>
  </div>
);

// Read-only full customer profile, reachable by clicking a customer name anywhere
// in the app (e.g. the Sales Ledger's Customer column) -- reuses the same
// Add/Edit customer dialogs the Customers page uses rather than forking them.
// `onReassign` is optional: when the caller is a specific business record (e.g. a
// sale) that can be re-pointed at a different customer, passing it enables the
// "Change Customer" flow; omit it for a plain "view this customer" use.
export function CustomerDetailDialog({
  customerId,
  onClose,
  onCustomerUpdated,
  onReassign,
}: {
  customerId: string;
  onClose: () => void;
  onCustomerUpdated?: () => void;
  onReassign?: (customerId: string, customerName: string) => void | Promise<void>;
}) {
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [loading, setLoading] = useState(true);
  const [showEdit, setShowEdit] = useState(false);
  const [showChange, setShowChange] = useState(false);
  const [reassigning, setReassigning] = useState(false);
  const supabase = createClient();

  const load = async (id: string) => {
    setLoading(true);
    const { data } = await supabase.from("customers").select("*").eq("id", id).single();
    setCustomer(data || null);
    setLoading(false);
  };

  useEffect(() => { load(customerId); }, [customerId]);

  const handleReassign = async (newId: string, newCustomerName: string) => {
    if (!onReassign) return;
    setReassigning(true);
    await onReassign(newId, newCustomerName);
    setReassigning(false);
    setShowChange(false);
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{loading ? "Customer" : customer?.customer_name || "Customer"}</DialogTitle>
        </DialogHeader>

        {loading ? (
          <div className="py-6 text-center text-sm text-muted-foreground">Loading…</div>
        ) : !customer ? (
          <div className="py-6 text-center text-sm text-destructive">Customer not found.</div>
        ) : (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <Field label="Type" value={customer.type} />
              <Field label="Phone" value={customer.phone} />
              <Field label="Email" value={customer.email} />
              <Field label="Has GST" value={customer.has_gst ? "Yes" : "No"} />
              <Field label="GST Number" value={customer.gst_number} />
              <Field label="State" value={customer.state ? `${customer.state} (${customer.state_code || "—"})` : null} />
              <Field label="Source" value={customer.source} />
              <Field label="Social Following" value={customer.social_following} />
              <Field label="Google Review" value={customer.google_review ? "Yes" : "No"} />
              {customer.created_at && (
                <Field label="Customer Since" value={new Date(customer.created_at).toLocaleDateString()} />
              )}
            </div>
            <Field label="Address" value={customer.address} />

            {showChange && (
              <div className="border rounded p-3 space-y-2">
                <div className="text-sm font-medium">Change to a different customer</div>
                <SearchableCustomerSelect
                  value={null}
                  onChange={() => {}}
                  onCustomerData={(c) => c && handleReassign(c.id, c.customer_name)}
                />
                {reassigning && <div className="text-xs text-muted-foreground flex items-center gap-1"><Loader2 className="size-3 animate-spin" /> Saving…</div>}
                <div className="flex justify-between items-center pt-1">
                  <AddCustomerDialog
                    onAdd={(created) => created && handleReassign(created.id, created.customer_name)}
                  />
                  <Button type="button" size="sm" variant="ghost" onClick={() => setShowChange(false)}>Cancel</Button>
                </div>
              </div>
            )}
          </div>
        )}

        <div className="flex justify-between pt-2">
          <div className="flex gap-2">
            {customer && (
              <Button type="button" size="sm" variant="outline" onClick={() => setShowEdit(true)}>
                Edit Customer
              </Button>
            )}
            {onReassign && !showChange && (
              <Button type="button" size="sm" variant="outline" onClick={() => setShowChange(true)}>
                Change Customer
              </Button>
            )}
          </div>
          <Button type="button" variant="outline" onClick={onClose}>Close</Button>
        </div>
      </DialogContent>

      {showEdit && customer && (
        <EditCustomerDialog
          customer={customer}
          open={showEdit}
          onOpenChange={setShowEdit}
          onUpdate={() => { load(customerId); onCustomerUpdated?.(); }}
        />
      )}
    </Dialog>
  );
}
