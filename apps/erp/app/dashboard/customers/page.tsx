"use client";

import { useState, useEffect, useCallback } from "react";
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import AddCustomerDialog from "@/components/AddCustomerDialog";
import BulkAddDialog from "@/components/BulkAddDialog";
import EditCustomerDialog from "@/components/EditCustomerDialog";
import DeleteRecordDialog from "@/components/DeleteRecordDialog";
import RequirePageAccess from "@/components/RequirePageAccess";
import { Pagination } from "@/components/Pagination";
import { CustomerNameLink } from "@/components/CustomerNameLink";
import { buildCustomerSummary } from "@/lib/customer-summary";

const PAGE_SIZE = 25

type SortField = "customer_name" | "type" | "phone" | "email";

function CustomersPage() {
  const [customers, setCustomers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingCustomer, setEditingCustomer] = useState<any | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [customerToDelete, setCustomerToDelete] = useState<any>(null);
  const [showDeleted, setShowDeleted] = useState(false);
  const [searchTerm, setSearchTerm] = useState(""); // GLOBAL SEARCH
  const supabase = createClient();

  const [typeFilter, setTypeFilter] = useState<string>("all");
  const [nameFilter, setNameFilter] = useState<string>("");
  const [sortField, setSortField] = useState<SortField>("customer_name");
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">("asc");
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);

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

    const { data, error, count } = await query;
    if (error) console.error(error);
    else { setCustomers(data || []); setTotal(count || 0); }
    setLoading(false);
  }, [showDeleted, searchTerm, typeFilter, nameFilter, sortField, sortOrder, page, supabase]);

  useEffect(() => { fetchCustomers(); }, [fetchCustomers]);

  // Any filter change invalidates the current page's meaning -- reset to page 1.
  useEffect(() => { setPage(1) }, [showDeleted, searchTerm, typeFilter, nameFilter]);

  const handleSort = (field: SortField) => {
    if (sortField === field) setSortOrder(sortOrder === "asc" ? "desc" : "asc");
    else { setSortField(field); setSortOrder("asc"); }
  };

  const handleEditClick = (c: any) => { setEditingCustomer(c); setDialogOpen(true); };
  const handleSoftDelete = async (remarks: string) => {
    if (!customerToDelete) return;
    await supabase.from("customers").update({ is_deleted: true, deleted_remarks: remarks, deleted_at: new Date().toISOString() }).eq("id", customerToDelete.id);
    fetchCustomers();
    setCustomerToDelete(null);
  };
  const [restoringId, setRestoringId] = useState<string | null>(null);
  const handleRestore = async (c: any) => {
    if (restoringId) return;
    setRestoringId(c.id);
    try {
      await supabase.from("customers").update({ is_deleted: false, deleted_remarks: null, deleted_at: null }).eq("id", c.id);
      fetchCustomers();
    } finally {
      setRestoringId(null);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
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

      {/* Filters Bar */}
      <div className="flex flex-wrap gap-4 items-end">
        {/* GLOBAL SEARCH BOX */}
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

        <div className="flex items-center space-x-2">
          <Checkbox id="showDeleted" checked={showDeleted} onCheckedChange={(v) => setShowDeleted(!!v)} />
          <Label htmlFor="showDeleted">Show deleted records</Label>
        </div>

        <Button variant="secondary" onClick={() => { setSearchTerm(""); setTypeFilter("all"); setNameFilter(""); }}>Clear Filters</Button>
      </div>

      {/* Table */}
      <div className="rounded-md border overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-10 text-right">#</TableHead>
              <TableHead className="cursor-pointer" onClick={() => handleSort("customer_name")}>Name {sortField === "customer_name" && (sortOrder === "asc" ? "↑" : "↓")}</TableHead>
              <TableHead className="cursor-pointer" onClick={() => handleSort("type")}>Type {sortField === "type" && (sortOrder === "asc" ? "↑" : "↓")}</TableHead>
              <TableHead>Contact Person</TableHead>
              <TableHead>GST</TableHead>
              <TableHead>Phone</TableHead>
              <TableHead className="cursor-pointer" onClick={() => handleSort("email")}>Email {sortField === "email" && (sortOrder === "asc" ? "↑" : "↓")}</TableHead>
              <TableHead>Source</TableHead>
              <TableHead>Social</TableHead>
              <TableHead>Deleted Remarks</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? <TableRow><TableCell colSpan={11} className="text-center">Loading…</TableCell></TableRow> : customers.length === 0 ? <TableRow><TableCell colSpan={11} className="text-center">No customers found.</TableCell></TableRow> : customers.map((c, idx) => (
              <TableRow key={c.id}>
                <TableCell className="text-right tabular-nums text-muted-foreground">{(page - 1) * PAGE_SIZE + idx + 1}</TableCell>
                <TableCell>
                  <CustomerNameLink
                    customerId={c.id}
                    customerName={c.customer_name}
                    summary={buildCustomerSummary(c)}
                    onUpdated={fetchCustomers}
                  />
                </TableCell>
                <TableCell>{c.type}</TableCell>
                <TableCell>{c.type === "Business" ? (c.contact_person || "—") : ""}</TableCell>
                <TableCell>{c.has_gst ? (c.gst_number || "Yes") : "No"}</TableCell>
                <TableCell>{c.phone}</TableCell>
                <TableCell>{c.email}</TableCell>
                <TableCell>{c.source}</TableCell>
                <TableCell>{c.social_following}</TableCell>
                <TableCell>{c.deleted_remarks}</TableCell>
                <TableCell className="text-right space-x-2">
                  {c.is_deleted ? (
                    <>
                      <Button variant="outline" size="sm" onClick={() => handleEditClick(c)}>Edit</Button>
                      <Button variant="default" size="sm" onClick={() => handleRestore(c)} loading={restoringId === c.id}>Restore</Button>
                    </>
                  ) : (
                    <>
                      <Button variant="outline" size="sm" onClick={() => handleEditClick(c)}>Edit</Button>
                      <Button variant="destructive" size="sm" onClick={() => { setCustomerToDelete(c); setDeleteDialogOpen(true); }}>Delete</Button>
                    </>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      <Pagination page={page} pageSize={PAGE_SIZE} total={total} onPageChange={setPage} />

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