"use client";

import { useState, useEffect, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { CalendarIcon, Columns, Plus, Copy, Eye } from "lucide-react";
import { format } from "date-fns";
import { Calendar } from "@/components/ui/calendar";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import AddPurchaseDialog from "@/components/AddPurchaseDialog";
import BulkAddDialog from "@/components/BulkAddDialog";
import EditPurchaseDialog from "@/components/EditPurchaseDialog";
import DeleteRecordDialog from "@/components/DeleteRecordDialog";
import FileUpload from "@/components/FileUpload";

type SortField = "purchase_date" | "vendor_name" | "asset_number" | "total_price" | "stock_status" | "status_purchase";
type SortOrder = "asc" | "desc";

const allColumns = [
  { key: "purchase_date", label: "Purchase Date" },
  { key: "entry_date", label: "Entry Date" },
  { key: "asset_number", label: "Asset No" },
  { key: "vendor_name", label: "Vendor" },
  { key: "type", label: "Type" },
  { key: "brand", label: "Brand" },
  { key: "model", label: "Model" },
  { key: "sku", label: "SKU" },
  { key: "cpu", label: "CPU" },
  { key: "ram", label: "RAM" },
  { key: "ssd", label: "SSD/HDD" },
  { key: "screen_size", label: "Screen Size (in)" },
  { key: "monitor_size", label: "Monitor Size (in)" },
  { key: "has_keyboard", label: "Keyboard" },
  { key: "has_mouse", label: "Mouse" },
  { key: "charger", label: "Charger" },
  { key: "serial_number", label: "Serial No" },
  { key: "asset_description", label: "Description" },
  { key: "base_price", label: "Base Price" },
  { key: "gst", label: "GST %" },
  { key: "total_price", label: "Total Price" },
  { key: "selling_price", label: "Selling Price" },
  { key: "purchase_type", label: "Purchase Type" },
  { key: "purchased_invoice_number", label: "Purchased Invoice No" },
  { key: "eway_bill_no", label: "Eway Bill No" },
  { key: "expense", label: "Expense" },
  { key: "expense_amount", label: "Expense Amt" },
  { key: "expense_description", label: "Expense Desc" },
  { key: "status_purchase", label: "Status" },
  { key: "status_other", label: "Other Status" },
  { key: "purchased_by_type", label: "Purchased By" },
  { key: "purchased_by_other", label: "Other Purchased By" },
  { key: "remarks", label: "Remarks" },
  { key: "is_deleted", label: "Deleted" },
];

const defaultVisibleColumns = [
  "purchase_date",
  "asset_number",
  "vendor_name",
  "type",
  "brand",
  "model",
  "total_price",
  "status_purchase",
];

export default function PurchasesPage() {
  const [purchases, setPurchases] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [totalCount, setTotalCount] = useState(0);
  const [page, setPage] = useState(1);
  const pageSize = 50;
  const [editingPurchase, setEditingPurchase] = useState<any | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [purchaseToDelete, setPurchaseToDelete] = useState<any>(null);
  const [showDeleted, setShowDeleted] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [viewItem, setViewItem] = useState<any>(null); // for view dialog
  const supabase = createClient();

  const [addDialogOpen, setAddDialogOpen] = useState(false);
  const [duplicateDialogOpen, setDuplicateDialogOpen] = useState(false);
  const [duplicateData, setDuplicateData] = useState<any>(null);

  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [vendorFilter, setVendorFilter] = useState<string>("");
  const [dateFrom, setDateFrom] = useState<Date | undefined>(undefined);
  const [dateTo, setDateTo] = useState<Date | undefined>(undefined);
  const [sortField, setSortField] = useState<SortField>("purchase_date");
  const [sortOrder, setSortOrder] = useState<SortOrder>("desc");

  const [visibleColumns, setVisibleColumns] = useState<string[]>(defaultVisibleColumns);

  const fetchPurchases = useCallback(async () => {
    setLoading(true);
    let countQuery = supabase.from("purchases").select("*", { count: "exact", head: true });
    if (showDeleted) countQuery = countQuery.eq("is_deleted", true);
    else countQuery = countQuery.eq("is_deleted", false);
    if (searchTerm) {
      countQuery = countQuery.or(
        `asset_number.ilike.%${searchTerm}%,` +
        `vendor_name.ilike.%${searchTerm}%,` +
        `sku.ilike.%${searchTerm}%,` +
        `brand.ilike.%${searchTerm}%,` +
        `model.ilike.%${searchTerm}%,` +
        `serial_number.ilike.%${searchTerm}%`
      );
    }
    if (statusFilter && statusFilter !== "all") countQuery = countQuery.eq("status_purchase", statusFilter);
    if (vendorFilter) countQuery = countQuery.ilike("vendor_name", `%${vendorFilter}%`);
    if (dateFrom) countQuery = countQuery.gte("purchase_date", format(dateFrom, "yyyy-MM-dd"));
    if (dateTo) countQuery = countQuery.lte("purchase_date", format(dateTo, "yyyy-MM-dd"));
    const { count, error: countError } = await countQuery;
    if (countError) console.error(countError);
    else setTotalCount(count || 0);

    let query = supabase.from("purchases").select("*");
    if (showDeleted) query = query.eq("is_deleted", true);
    else query = query.eq("is_deleted", false);
    if (searchTerm) {
      query = query.or(
        `asset_number.ilike.%${searchTerm}%,` +
        `vendor_name.ilike.%${searchTerm}%,` +
        `sku.ilike.%${searchTerm}%,` +
        `brand.ilike.%${searchTerm}%,` +
        `model.ilike.%${searchTerm}%,` +
        `serial_number.ilike.%${searchTerm}%`
      );
    }
    if (statusFilter && statusFilter !== "all") query = query.eq("status_purchase", statusFilter);
    if (vendorFilter) query = query.ilike("vendor_name", `%${vendorFilter}%`);
    if (dateFrom) query = query.gte("purchase_date", format(dateFrom, "yyyy-MM-dd"));
    if (dateTo) query = query.lte("purchase_date", format(dateTo, "yyyy-MM-dd"));
    query = query.order(sortField, { ascending: sortOrder === "asc" });
    query = query.range((page - 1) * pageSize, page * pageSize - 1);
    const { data, error } = await query;
    if (error) console.error(error);
    else setPurchases(data || []);
    setLoading(false);
  }, [showDeleted, searchTerm, statusFilter, vendorFilter, dateFrom, dateTo, sortField, sortOrder, page, pageSize, supabase]);

  useEffect(() => {
    fetchPurchases();
  }, [fetchPurchases]);

  const handleSort = (field: SortField) => {
    if (sortField === field) setSortOrder(sortOrder === "asc" ? "desc" : "asc");
    else setSortField(field), setSortOrder("asc");
    setPage(1);
  };

  const handleEditClick = (purchase: any) => {
    setEditingPurchase(purchase);
    setDialogOpen(true);
  };

  const handleSoftDelete = async (remarks: string) => {
    if (!purchaseToDelete) return;
    const { error } = await supabase
      .from("purchases")
      .update({ is_deleted: true, deleted_remarks: remarks, deleted_at: new Date().toISOString() })
      .eq("id", purchaseToDelete.id);
    if (error) console.error(error);
    else fetchPurchases();
    setPurchaseToDelete(null);
  };

  const handleRestore = async (purchase: any) => {
    const { error } = await supabase
      .from("purchases")
      .update({ is_deleted: false, deleted_remarks: null, deleted_at: null })
      .eq("id", purchase.id);
    if (error) console.error(error);
    else fetchPurchases();
  };

  const totalPages = Math.ceil(totalCount / pageSize);

  const renderCell = (p: any, colKey: string) => {
    switch (colKey) {
      case "purchase_date": return p.purchase_date?.slice(0, 10);
      case "entry_date": return p.entry_date?.slice(0, 10);
      case "asset_number": return p.asset_number;
      case "vendor_name": return p.vendor_name;
      case "type": return p.type;
      case "brand": return p.brand || "-";
      case "model": return p.model || "-";
      case "sku": return p.sku || "-";
      case "cpu": return p.cpu || "-";
      case "ram": return p.ram || "-";
      case "ssd": return p.ssd || "-";
      case "screen_size": return p.screen_size || "-";
      case "monitor_size": return p.monitor_size || "-";
      case "has_keyboard": return p.has_keyboard ? "Yes" : "No";
      case "has_mouse": return p.has_mouse ? "Yes" : "No";
      case "charger": return p.charger ? "Yes" : "No";
      case "serial_number": return p.serial_number || "-";
      case "asset_description": return p.asset_description || "-";
      case "base_price": return p.base_price ? `₹${p.base_price.toFixed(2)}` : "-";
      case "gst": return p.gst ? `${p.gst}%` : "-";
      case "total_price": return p.total_price ? `₹${p.total_price.toFixed(2)}` : "-";
      case "selling_price": return p.selling_price ? `₹${p.selling_price.toFixed(2)}` : "-";
      case "purchase_type": return p.purchase_type || "-";
      case "purchased_invoice_number": return p.purchased_invoice_number || "-";
      case "eway_bill_no": return p.eway_bill_no || "-";
      case "expense": return p.expense ? "Yes" : "No";
      case "expense_amount": return p.expense_amount ? `₹${p.expense_amount.toFixed(2)}` : "-";
      case "expense_description": return p.expense_description || "-";
      case "status_purchase": return p.status_purchase === "Other" ? p.status_other : p.status_purchase;
      case "status_other": return p.status_other || "-";
      case "purchased_by_type": return p.purchased_by_type === "Other" ? p.purchased_by_other : p.purchased_by_type;
      case "purchased_by_other": return p.purchased_by_other || "-";
      case "remarks": return p.remarks || "-";
      case "is_deleted": return p.is_deleted ? "Yes" : "No";
      default: return "-";
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <h1 className="text-2xl font-bold">Purchases</h1>
        <div className="space-x-2">
          <Button onClick={() => setAddDialogOpen(true)}>
            <Plus className="mr-2 h-4 w-4" /> Add Purchase
          </Button>
          <BulkAddDialog
            tableName="purchases"
            onAdd={fetchPurchases}
            transformRow={(row: any) => ({
              purchase_date: row.purchase_date,
              vendor_name: row.vendor_name,
              asset_number: row.asset_number,
              sku: row.sku,
              type: row.type,
              brand: row.brand,
              model: row.model,
              cpu: row.cpu,
              ram: row.ram,
              ssd: row.ssd,
              charger: row.charger === "true" || row.charger === true,
              asset_description: row.asset_description,
              serial_number: row.serial_number,
              base_price: row.base_price ? parseFloat(row.base_price) : null,
              gst: row.gst ? parseFloat(row.gst) : null,
              total_price: row.total_price ? parseFloat(row.total_price) : null,
              selling_price: row.selling_price ? parseFloat(row.selling_price) : null,
              expense: row.expense === "true" || row.expense === true,
              expense_amount: row.expense_amount ? parseFloat(row.expense_amount) : null,
              expense_description: row.expense_description,
              status_purchase: row.status_purchase,
              status_other: row.status_other,
              purchased_by_type: row.purchased_by_type,
              purchased_by_other: row.purchased_by_other,
              remarks: row.remarks,
              is_deleted: false,
            })}
          />
        </div>
      </div>

      {/* Filters Bar */}
      <div className="flex flex-wrap gap-4 items-end">
        <div className="w-64">
          <Label>Search</Label>
          <Input placeholder="Asset, vendor, serial, brand..." value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} />
        </div>
        <div className="w-48">
          <Label>Status</Label>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger><SelectValue placeholder="All statuses" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All</SelectItem>
              <SelectItem value="Ready for Sale">Ready for Sale</SelectItem>
              <SelectItem value="QC Pending">QC Pending</SelectItem>
              <SelectItem value="Faulty">Faulty</SelectItem>
              <SelectItem value="Other">Other</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="w-64">
          <Label>Vendor (contains)</Label>
          <Input placeholder="Vendor name" value={vendorFilter} onChange={(e) => setVendorFilter(e.target.value)} />
        </div>
        <div>
          <Label>From Date</Label>
          <Popover>
            <PopoverTrigger asChild>
              <Button variant="outline"><CalendarIcon className="mr-2 h-4 w-4"/>{dateFrom ? format(dateFrom, "dd/MM/yyyy") : "Select"}</Button>
            </PopoverTrigger>
            <PopoverContent><Calendar mode="single" selected={dateFrom} onSelect={setDateFrom} /></PopoverContent>
          </Popover>
        </div>
        <div>
          <Label>To Date</Label>
          <Popover>
            <PopoverTrigger asChild>
              <Button variant="outline"><CalendarIcon className="mr-2 h-4 w-4"/>{dateTo ? format(dateTo, "dd/MM/yyyy") : "Select"}</Button>
            </PopoverTrigger>
            <PopoverContent><Calendar mode="single" selected={dateTo} onSelect={setDateTo} /></PopoverContent>
          </Popover>
        </div>
        <div className="flex items-center space-x-2">
          <input type="checkbox" id="showDeleted" checked={showDeleted} onChange={(e) => setShowDeleted(e.target.checked)} />
          <Label htmlFor="showDeleted">Show deleted records</Label>
        </div>
        <Button variant="secondary" onClick={() => {
          setSearchTerm("");
          setStatusFilter("all");
          setVendorFilter("");
          setDateFrom(undefined);
          setDateTo(undefined);
          setPage(1);
        }}>
          Clear Filters
        </Button>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="sm"><Columns className="mr-2 h-4 w-4" /> Columns</Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56 max-h-96 overflow-y-auto">
            {allColumns.map((col) => (
              <DropdownMenuCheckboxItem
                key={col.key}
                checked={visibleColumns.includes(col.key)}
                onCheckedChange={(checked) => {
                  if (checked) setVisibleColumns([...visibleColumns, col.key]);
                  else setVisibleColumns(visibleColumns.filter((k) => k !== col.key));
                }}
              >
                {col.label}
              </DropdownMenuCheckboxItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {/* Table */}
      <div className="rounded-md border overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              {allColumns.filter(col => visibleColumns.includes(col.key)).map((col) => (
                <TableHead key={col.key} className="cursor-pointer" onClick={() => {
                  if (col.key === "purchase_date") handleSort("purchase_date");
                  else if (col.key === "vendor_name") handleSort("vendor_name");
                  else if (col.key === "asset_number") handleSort("asset_number");
                  else if (col.key === "total_price") handleSort("total_price");
                  else if (col.key === "status_purchase") handleSort("status_purchase");
                }}>
                  {col.label}
                  {(col.key === "purchase_date" || col.key === "vendor_name" || col.key === "asset_number" || col.key === "total_price" || col.key === "status_purchase") && (
                    sortField === col.key && (sortOrder === "asc" ? " ↑" : " ↓")
                  )}
                </TableHead>
              ))}
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow><TableCell colSpan={visibleColumns.length + 1} className="text-center">Loading…</TableCell></TableRow>
            ) : purchases.length === 0 ? (
              <TableRow><TableCell colSpan={visibleColumns.length + 1} className="text-center">No purchases found.</TableCell></TableRow>
            ) : (
              purchases.map((p) => (
                <TableRow key={p.id} className={p.is_deleted ? "opacity-50" : ""}>
                  {allColumns.filter(col => visibleColumns.includes(col.key)).map((col) => (
                    <TableCell key={col.key}>{renderCell(p, col.key)}</TableCell>
                  ))}
                  <TableCell className="text-right space-x-2">
                    {!p.is_deleted ? (
                      <>
                        <Button variant="ghost" size="sm" onClick={() => setViewItem(p)}>
                          <Eye className="h-4 w-4" />
                        </Button>
                        <Button variant="outline" size="sm" onClick={() => handleEditClick(p)}>Edit</Button>
                        <Button variant="destructive" size="sm" onClick={() => { setPurchaseToDelete(p); setDeleteDialogOpen(true); }}>Delete</Button>
                        <Button variant="ghost" size="sm" onClick={() => { setDuplicateData(p); setDuplicateDialogOpen(true); }}>
                          <Copy className="h-4 w-4" />
                        </Button>
                      </>
                    ) : (
                      <Button variant="default" size="sm" onClick={() => handleRestore(p)}>Restore</Button>
                    )}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      {/* Pagination */}
      {totalCount > 0 && (
        <div className="flex justify-between items-center">
          <div className="text-sm text-muted-foreground">
            Showing {(page - 1) * pageSize + 1} to {Math.min(page * pageSize, totalCount)} of {totalCount} entries
          </div>
          <div className="space-x-2">
            <Button variant="outline" size="sm" onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}>Previous</Button>
            <Button variant="outline" size="sm" onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page === totalPages}>Next</Button>
          </div>
        </div>
      )}

      {/* Dialogs */}
      <AddPurchaseDialog
        onAdd={fetchPurchases}
        open={addDialogOpen}
        onOpenChange={setAddDialogOpen}
      />
      <AddPurchaseDialog
        onAdd={fetchPurchases}
        open={duplicateDialogOpen}
        onOpenChange={setDuplicateDialogOpen}
        initialData={duplicateData}
      />
      {editingPurchase && (
        <EditPurchaseDialog
          purchase={editingPurchase}
          open={dialogOpen}
          onOpenChange={setDialogOpen}
          onUpdate={fetchPurchases}
        />
      )}
      {purchaseToDelete && (
        <DeleteRecordDialog
          title="Delete Purchase"
          identifier={purchaseToDelete.asset_number}
          open={deleteDialogOpen}
          onOpenChange={setDeleteDialogOpen}
          onConfirm={handleSoftDelete}
        />
      )}

      {/* View Dialog */}
      <Dialog open={!!viewItem} onOpenChange={() => setViewItem(null)}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Purchase Details: {viewItem?.asset_number}</DialogTitle>
          </DialogHeader>
          {viewItem && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div><Label>Entry Date</Label><p className="text-sm">{viewItem.entry_date?.slice(0,10)}</p></div>
                <div><Label>Purchase Date</Label><p className="text-sm">{viewItem.purchase_date?.slice(0,10)}</p></div>
                <div><Label>Vendor</Label><p className="text-sm">{viewItem.vendor_name}</p></div>
                <div><Label>Asset Number</Label><p className="text-sm">{viewItem.asset_number}</p></div>
                <div><Label>Type</Label><p className="text-sm">{viewItem.type}</p></div>
                <div><Label>Brand / Model</Label><p className="text-sm">{viewItem.brand} {viewItem.model}</p></div>
                <div><Label>SKU</Label><p className="text-sm">{viewItem.sku}</p></div>
                <div><Label>CPU / RAM / SSD</Label><p className="text-sm">{viewItem.cpu} / {viewItem.ram} / {viewItem.ssd}</p></div>
                <div><Label>Screen Size (Laptop/Monitor)</Label><p className="text-sm">{viewItem.screen_size || '-'}</p></div>
                <div><Label>Monitor Size (Desktop)</Label><p className="text-sm">{viewItem.monitor_size || '-'}</p></div>
                <div><Label>Keyboard / Mouse (Desktop)</Label><p className="text-sm">{viewItem.has_keyboard ? 'Yes' : 'No'} / {viewItem.has_mouse ? 'Yes' : 'No'}</p></div>
                <div><Label>Charger</Label><p className="text-sm">{viewItem.charger ? 'Yes' : 'No'}</p></div>
                <div><Label>Serial Number</Label><p className="text-sm">{viewItem.serial_number || '-'}</p></div>
                <div><Label>Asset Description</Label><p className="text-sm">{viewItem.asset_description || '-'}</p></div>
                <div><Label>Base Price</Label><p className="text-sm">₹{viewItem.base_price?.toFixed(2)}</p></div>
                <div><Label>GST %</Label><p className="text-sm">{viewItem.gst ?? '-'}%</p></div>
                <div><Label>Total Price</Label><p className="text-sm">₹{viewItem.total_price?.toFixed(2)}</p></div>
                <div><Label>Selling Price</Label><p className="text-sm">₹{viewItem.selling_price?.toFixed(2)}</p></div>
                <div><Label>Purchase Type</Label><p className="text-sm">{viewItem.purchase_type}</p></div>
                <div><Label>Purchased Invoice No</Label><p className="text-sm">{viewItem.purchased_invoice_number || '-'}</p></div>
                <div><Label>Eway Bill No</Label><p className="text-sm">{viewItem.eway_bill_no || '-'}</p></div>
                <div><Label>Expense</Label><p className="text-sm">{viewItem.expense ? `Yes (₹${viewItem.expense_amount?.toFixed(2)} - ${viewItem.expense_description})` : 'No'}</p></div>
                <div><Label>Status</Label><p className="text-sm">{viewItem.status_purchase === "Other" ? viewItem.status_other : viewItem.status_purchase}</p></div>
                <div><Label>Purchased By</Label><p className="text-sm">{viewItem.purchased_by_type === "Other" ? viewItem.purchased_by_other : viewItem.purchased_by_type}</p></div>
                <div className="col-span-2"><Label>Remarks</Label><p className="text-sm whitespace-pre-wrap">{viewItem.remarks || '-'}</p></div>
                <div className="col-span-2"><Label>Public Photo URL</Label>
                  {viewItem.public_photo_url ? (
                    <div className="flex gap-2 items-center">
                      <a href={viewItem.public_photo_url} target="_blank" rel="noopener noreferrer" className="text-blue-600 text-sm break-all">{viewItem.public_photo_url}</a>
                      <Button size="sm" variant="ghost" onClick={() => { navigator.clipboard.writeText(viewItem.public_photo_url); alert('Copied!'); }}>Copy</Button>
                    </div>
                  ) : <p className="text-sm text-gray-400">None</p>}
                </div>
              </div>
              <div className="border-t pt-4">
                <h4 className="text-sm font-medium mb-3">Attached Files (Invoices, E-Way Bills, Receipts)</h4>
                <FileUpload purchaseId={viewItem.id} assetNumber={viewItem.asset_number} />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button onClick={() => setViewItem(null)}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}