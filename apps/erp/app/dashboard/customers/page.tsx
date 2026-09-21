"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ArrowLeft, Star } from "lucide-react";
import AddCustomerDialog from "@/components/AddCustomerDialog";
import BulkAddDialog from "@/components/BulkAddDialog";
import EditCustomerDialog from "@/components/EditCustomerDialog";
import DeleteRecordDialog from "@/components/DeleteRecordDialog";
import RequirePageAccess from "@/components/RequirePageAccess";
import { StatusBadge } from "@/components/StatusBadge";
import { Pagination } from "@/components/Pagination";
import { withRetry } from "@/lib/db-retry";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

const PAGE_SIZE = 25

interface Customer {
  id: string;
  customer_name: string;
  type: string;
  contact_person?: string | null;
  has_gst: boolean;
  gst_number: string;
  address: string;
  phone: string;
  email: string;
  source: string;
  google_review: boolean;
  social_following: string;
  is_deleted?: boolean;
  deleted_remarks?: string | null;
}

// One field in the detail pane's label/value grid -- keeps every row's spacing
// and label styling consistent without repeating the wrapper markup (matches
// Sales Ledger's Field helper).
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="py-2.5 border-b border-border grid grid-cols-3 gap-2 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className="col-span-2">{children}</span>
    </div>
  );
}

// Left-pane list block -- a contact-list row rather than a transaction row (this
// page has no status field): name, phone, and a couple of small badges (type,
// GST-registered) are what's scannable at a glance. Email is left out of the
// compact row (too long) and shown in the detail pane instead.
function CustomerListItem({ customer, active, onOpen }: {
  customer: Customer;
  active: boolean;
  onOpen: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className={cn(
        "w-full text-left px-3 py-2.5 border-b border-border flex items-start gap-2.5 transition-colors",
        active ? "bg-primary/10" : "hover:bg-muted",
        customer.is_deleted && "opacity-50"
      )}
    >
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-2">
          <span className="font-medium text-sm text-foreground truncate">{customer.customer_name || "—"}</span>
          {customer.google_review && <Star className="size-3.5 text-warning fill-yellow-500 flex-shrink-0" />}
        </div>
        <p className="text-xs text-muted-foreground truncate mt-0.5">{customer.phone || "—"}</p>
        <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
          <StatusBadge tone={customer.type === "Business" ? "info" : "neutral"}>{customer.type || "—"}</StatusBadge>
          {customer.has_gst && <StatusBadge tone="success">GST</StatusBadge>}
          {customer.is_deleted && <StatusBadge tone="danger">Deleted</StatusBadge>}
        </div>
      </div>
    </button>
  );
}

// Right-pane detail view -- the same fields the old wide table's columns showed
// for one customer, laid out as a single record instead of a table row. Every
// action (Edit/Delete/Restore) is preserved exactly from the table view.
function CustomerDetailPane({ customer, onEdit, onDelete, onRestore, restoring, onBack }: {
  customer: Customer;
  onEdit: () => void;
  onDelete: () => void;
  onRestore: () => void;
  restoring: boolean;
  onBack: () => void;
}) {
  return (
    <div className={cn("flex flex-col h-full", customer.is_deleted && "opacity-60")}>
      <div className="flex items-start justify-between gap-3 p-4 border-b border-border">
        <div className="min-w-0">
          <button type="button" onClick={onBack} className="md:hidden mb-2 inline-flex items-center gap-1 text-sm text-muted-foreground">
            <ArrowLeft className="size-4" /> Back to list
          </button>
          <h2 className="text-lg font-semibold text-foreground truncate">{customer.customer_name || "—"}</h2>
          <div className="flex items-center gap-1.5 mt-1 flex-wrap">
            <StatusBadge tone={customer.type === "Business" ? "info" : "neutral"}>{customer.type || "—"}</StatusBadge>
            {customer.has_gst && <StatusBadge tone="success">GST Registered</StatusBadge>}
            {customer.is_deleted && <StatusBadge tone="danger">Deleted</StatusBadge>}
          </div>
        </div>
        <div className="flex flex-col items-end gap-1.5 flex-shrink-0">
          {customer.is_deleted ? (
            <>
              <Button variant="outline" size="sm" onClick={onEdit}>Edit</Button>
              <Button variant="default" size="sm" onClick={onRestore} loading={restoring}>Restore</Button>
            </>
          ) : (
            <>
              <Button variant="outline" size="sm" onClick={onEdit}>Edit</Button>
              <Button variant="destructive" size="sm" onClick={onDelete}>Delete</Button>
            </>
          )}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-4">
        <Field label="Type">{customer.type || "—"}</Field>
        {customer.type === "Business" && (
          <Field label="Contact Person">{customer.contact_person || "—"}</Field>
        )}
        <Field label="Phone">{customer.phone || "—"}</Field>
        <Field label="Email">{customer.email || "—"}</Field>
        <Field label="Address">{customer.address || "—"}</Field>
        <Field label="GST">{customer.has_gst ? (customer.gst_number || "Yes") : "No"}</Field>
        <Field label="Source">{customer.source || "—"}</Field>
        <Field label="Social Following">{customer.social_following || "—"}</Field>
        <Field label="Google Review">
          {customer.google_review ? (
            <span className="inline-flex items-center gap-1"><Star className="size-3.5 text-warning fill-yellow-500" /> Yes</span>
          ) : "No"}
        </Field>
        {customer.is_deleted && (
          <Field label="Deleted Remarks">{customer.deleted_remarks || "—"}</Field>
        )}
      </div>
    </div>
  );
}

type SortField = "customer_name" | "type" | "phone" | "email";

function CustomersPage() {
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingCustomer, setEditingCustomer] = useState<Customer | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [customerToDelete, setCustomerToDelete] = useState<Customer | null>(null);
  const [showDeleted, setShowDeleted] = useState(false);
  const [searchTerm, setSearchTerm] = useState(""); // GLOBAL SEARCH
  const supabase = createClient();

  const [typeFilter, setTypeFilter] = useState<string>("all");
  const [nameFilter, setNameFilter] = useState<string>("");
  const [sortField, setSortField] = useState<SortField>("customer_name");
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">("asc");
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  // Which customer is open in the right-hand detail pane.
  const [activeCustomerId, setActiveCustomerId] = useState<string | null>(null);

  const fetchCustomers = useCallback(async () => {
    setLoading(true);
    let query = supabase.from("customers").select("*", { count: "exact" });

    if (showDeleted) query = query.eq("is_deleted", true);
    else query = query.eq("is_deleted", false);

    // GLOBAL SEARCH across multiple columns
    if (searchTerm) {
      query = query.or(
        `customer_name.ilike.%${searchTerm}%,` +
        `type.ilike.%${searchTerm}%,` +
        `contact_person.ilike.%${searchTerm}%,` +
        `gst_number.ilike.%${searchTerm}%,` +
        `address.ilike.%${searchTerm}%,` +
        `phone.ilike.%${searchTerm}%,` +
        `email.ilike.%${searchTerm}%,` +
        `source.ilike.%${searchTerm}%,` +
        `social_following.ilike.%${searchTerm}%`
      );
    }

    if (typeFilter && typeFilter !== "all") query = query.eq("type", typeFilter);
    if (nameFilter) query = query.ilike("customer_name", `%${nameFilter}%`);

    query = query.order(sortField, { ascending: sortOrder === "asc" });
    query = query.range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1);

    const { data, error, count } = await withRetry(() => query);
    if (error) {
      console.error(error);
      toast.error("Unable to load customers -- check your connection and try again.");
    } else {
      const rows: Customer[] = data || [];
      setCustomers(rows);
      setTotal(count || 0);
      // Auto-open the first row on load/refetch -- but only when nothing is
      // selected yet, or the previously active customer fell off this
      // page/filter, so re-fetching after an edit doesn't yank focus away
      // from what the user is currently looking at (matches Sales Ledger).
      setActiveCustomerId((prev) => (prev && rows.some((c) => c.id === prev)) ? prev : (rows[0]?.id ?? null));
    }
    setLoading(false);
  }, [showDeleted, searchTerm, typeFilter, nameFilter, sortField, sortOrder, page, supabase]);

  useEffect(() => { fetchCustomers(); }, [fetchCustomers]);

  // Any filter change invalidates the current page's meaning -- reset to page 1.
  useEffect(() => { setPage(1) }, [showDeleted, searchTerm, typeFilter, nameFilter]);

  const handleEditClick = (c: Customer) => { setEditingCustomer(c); setDialogOpen(true); };
  const handleSoftDelete = async (remarks: string) => {
    if (!customerToDelete) return;
    await supabase.from("customers").update({ is_deleted: true, deleted_remarks: remarks, deleted_at: new Date().toISOString() }).eq("id", customerToDelete.id);
    fetchCustomers();
    setCustomerToDelete(null);
  };
  const [restoringId, setRestoringId] = useState<string | null>(null);
  const handleRestore = async (c: Customer) => {
    if (restoringId) return;
    setRestoringId(c.id);
    try {
      await supabase.from("customers").update({ is_deleted: false, deleted_remarks: null, deleted_at: null }).eq("id", c.id);
      fetchCustomers();
    } finally {
      setRestoringId(null);
    }
  };

  const activeCustomer = useMemo(() => customers.find(c => c.id === activeCustomerId) ?? null, [customers, activeCustomerId]);

  return (
    <div className="p-4 flex flex-col" style={{ height: "calc(100vh - 2rem)" }}>
      <div className="flex justify-between items-center mb-4">
        <h1 className="text-2xl font-bold">Customers</h1>
        <div className="space-x-2">
          <AddCustomerDialog onAdd={fetchCustomers} />
          <BulkAddDialog
            tableName="customers"
            onAdd={fetchCustomers}
            transformRow={(row: any) => ({
              customer_name: row.customer_name,
              type: row.type,
              contact_person: row.contact_person,
              has_gst: row.has_gst === "true" || row.has_gst === "TRUE" || row.has_gst === true,
              gst_number: row.gst_number,
              address: row.address,
              phone: row.phone,
              email: row.email,
              source: row.source,
              google_review: row.google_review === "true" || row.google_review === "TRUE" || row.google_review === true,
              social_following: row.social_following,
              is_deleted: false,
            })}
          />
        </div>
      </div>

      {/* Filters Bar -- unchanged in behavior */}
      <div className="flex flex-wrap gap-4 items-end mb-4">
        <div className="w-64">
          <Label>Global Search</Label>
          <Input
            placeholder="Name, GST, phone, email..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
        </div>

        <div className="w-48">
          <Label>Type</Label>
          <Select value={typeFilter} onValueChange={setTypeFilter}>
            <SelectTrigger><SelectValue placeholder="All types" /></SelectTrigger>
            <SelectContent><SelectItem value="all">All</SelectItem><SelectItem value="Business">Business</SelectItem><SelectItem value="Individual">Individual</SelectItem></SelectContent>
          </Select>
        </div>

        <div className="w-64">
          <Label>Name contains</Label>
          <Input placeholder="Search name" value={nameFilter} onChange={(e) => setNameFilter(e.target.value)} />
        </div>

        <div className="w-48">
          <Label>Sort by</Label>
          <Select value={sortField} onValueChange={(v) => setSortField(v as SortField)}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="customer_name">Name</SelectItem>
              <SelectItem value="type">Type</SelectItem>
              <SelectItem value="phone">Phone</SelectItem>
              <SelectItem value="email">Email</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <Button variant="outline" onClick={() => setSortOrder(sortOrder === "asc" ? "desc" : "asc")}>
          {sortOrder === "asc" ? "↑ Asc" : "↓ Desc"}
        </Button>

        <div className="flex items-center space-x-2">
          <Checkbox id="showDeleted" checked={showDeleted} onCheckedChange={(v) => setShowDeleted(!!v)} />
          <Label htmlFor="showDeleted">Show deleted records</Label>
        </div>

        <Button variant="secondary" onClick={() => { setSearchTerm(""); setTypeFilter("all"); setNameFilter(""); }}>Clear Filters</Button>
      </div>

      {loading ? (
        <div>Loading...</div>
      ) : (
        <div className="flex-1 min-h-0 border rounded overflow-hidden flex">
          {/* List pane -- hidden on mobile once a customer is open, matching an
              email client's drill-in navigation; always visible at md+. */}
          <div className={cn("w-full md:w-[360px] md:flex-shrink-0 border-r border-border flex flex-col", activeCustomer && "hidden md:flex")}>
            <div className="flex-1 overflow-y-auto">
              {customers.map((c) => (
                <CustomerListItem
                  key={c.id}
                  customer={c}
                  active={c.id === activeCustomerId}
                  onOpen={() => setActiveCustomerId(c.id)}
                />
              ))}
              {customers.length === 0 && (
                <p className="p-4 text-center text-sm text-muted-foreground">No customers found.</p>
              )}
            </div>
            <div className="border-t border-border p-2">
              <Pagination page={page} pageSize={PAGE_SIZE} total={total} onPageChange={setPage} />
            </div>
          </div>

          {/* Detail pane -- full width on mobile (replaces the list), flex-1 at md+. */}
          <div className={cn("flex-1 min-w-0", !activeCustomer && "hidden md:flex md:items-center md:justify-center")}>
            {activeCustomer ? (
              <CustomerDetailPane
                customer={activeCustomer}
                onEdit={() => handleEditClick(activeCustomer)}
                onDelete={() => { setCustomerToDelete(activeCustomer); setDeleteDialogOpen(true); }}
                onRestore={() => handleRestore(activeCustomer)}
                restoring={restoringId === activeCustomer.id}
                onBack={() => setActiveCustomerId(null)}
              />
            ) : (
              <p className="text-sm text-muted-foreground">Select a customer to view details.</p>
            )}
          </div>
        </div>
      )}

      {editingCustomer && <EditCustomerDialog customer={editingCustomer} open={dialogOpen} onOpenChange={setDialogOpen} onUpdate={fetchCustomers} />}
      {customerToDelete && <DeleteRecordDialog title="Delete Customer" identifier={customerToDelete.customer_name} open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen} onConfirm={handleSoftDelete} />}
    </div>
  );
}

export default function CustomersPageGuarded() {
  return (
    <RequirePageAccess pageKey="customers">
      <CustomersPage />
    </RequirePageAccess>
  );
}
