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
import { CalendarIcon } from "lucide-react";
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
import AddPurchaseDialog from "@/components/AddPurchaseDialog";
import BulkAddDialog from "@/components/BulkAddDialog";
import EditPurchaseDialog from "@/components/EditPurchaseDialog";
import DeleteRecordDialog from "@/components/DeleteRecordDialog";

type SortField = "purchase_date" | "vendor_name" | "asset_number" | "total_price" | "stock_status";
type SortOrder = "asc" | "desc";

export default function PurchasesPage() {
  const [purchases, setPurchases] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingPurchase, setEditingPurchase] = useState<any | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [purchaseToDelete, setPurchaseToDelete] = useState<any>(null);
  const [showDeleted, setShowDeleted] = useState(false);
  const [searchTerm, setSearchTerm] = useState(""); // 👈 GLOBAL SEARCH
  const supabase = createClient();

  // Filter & sort state
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [vendorFilter, setVendorFilter] = useState<string>("");
  const [dateFrom, setDateFrom] = useState<Date | undefined>(undefined);
  const [dateTo, setDateTo] = useState<Date | undefined>(undefined);
  const [sortField, setSortField] = useState<SortField>("purchase_date");
  const [sortOrder, setSortOrder] = useState<SortOrder>("desc");

  const fetchPurchases = useCallback(async () => {
    setLoading(true);
    let query = supabase.from("purchases").select("*");

    // Show only deleted or active
    if (showDeleted) {
      query = query.eq("is_deleted", true);
    } else {
      query = query.eq("is_deleted", false);
    }

    // 🔍 GLOBAL SEARCH across multiple columns
    if (searchTerm) {
      query = query.or(
        `asset_number.ilike.%${searchTerm}%,` +
        `vendor_name.ilike.%${searchTerm}%,` +
        `sku.ilike.%${searchTerm}%,` +
        `type.ilike.%${searchTerm}%,` +
        `asset_description.ilike.%${searchTerm}%,` +
        `serial_number.ilike.%${searchTerm}%,` +
        `purchased_by.ilike.%${searchTerm}%,` +
        `stock_status.ilike.%${searchTerm}%`
      );
    }

    // Status filter (stock_status)
    if (statusFilter && statusFilter !== "all") {
      query = query.eq("stock_status", statusFilter);
    }

    // Vendor filter (specific column)
    if (vendorFilter) {
      query = query.ilike("vendor_name", `%${vendorFilter}%`);
    }

    // Date range
    if (dateFrom) {
      query = query.gte("purchase_date", format(dateFrom, "yyyy-MM-dd"));
    }
    if (dateTo) {
      query = query.lte("purchase_date", format(dateTo, "yyyy-MM-dd"));
    }

    // Sorting
    query = query.order(sortField, { ascending: sortOrder === "asc" });

    const { data, error } = await query;
    if (error) console.error(error);
    else setPurchases(data || []);
    setLoading(false);
  }, [showDeleted, searchTerm, statusFilter, vendorFilter, dateFrom, dateTo, sortField, sortOrder, supabase]);

  useEffect(() => {
    fetchPurchases();
  }, [fetchPurchases]);

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortOrder(sortOrder === "asc" ? "desc" : "asc");
    } else {
      setSortField(field);
      setSortOrder("asc");
    }
  };

  const handleEditClick = (purchase: any) => {
    setEditingPurchase(purchase);
    setDialogOpen(true);
  };

  const handleSoftDelete = async (remarks: string) => {
    if (!purchaseToDelete) return;
    const { error } = await supabase
      .from("purchases")
      .update({
        is_deleted: true,
        deleted_remarks: remarks,
        deleted_at: new Date().toISOString(),
      })
      .eq("id", purchaseToDelete.id);
    if (error) console.error(error);
    else fetchPurchases();
    setPurchaseToDelete(null);
  };

  const handleRestore = async (purchase: any) => {
    await supabase
      .from("purchases")
      .update({ is_deleted: false, deleted_remarks: null, deleted_at: null })
      .eq("id", purchase.id);
    fetchPurchases();
  };

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <h1 className="text-2xl font-bold">Purchases</h1>
        <div className="space-x-2">
          <AddPurchaseDialog onAdd={fetchPurchases} />
          <BulkAddDialog
            tableName="purchases"
            onAdd={fetchPurchases}
            transformRow={(row: any) => ({
              purchase_date: row.purchase_date,
              vendor_name: row.vendor_name,
              asset_number: row.asset_number,
              sku: row.sku,
              type: row.type,
              asset_description: row.asset_description,
              serial_number: row.serial_number,
              base_price: row.base_price ? parseFloat(row.base_price) : null,
              gst: row.gst ? parseFloat(row.gst) : null,
              total_price: row.total_price ? parseFloat(row.total_price) : null,
              stock_status: row.stock_status,
              purchased_by: row.purchased_by,
              purchase_type: row.purchase_type,
              is_deleted: false,
            })}
          />
        </div>
      </div>

      {/* Filters Bar - includes GLOBAL SEARCH box */}
      <div className="flex flex-wrap gap-4 items-end">
        {/* 🔍 GLOBAL SEARCH BOX */}
        <div className="w-64">
          <Label>Global Search</Label>
          <Input
            placeholder="Any keyword (asset, vendor, serial...)"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
        </div>

        <div className="w-48">
          <Label>Status</Label>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger><SelectValue placeholder="All statuses" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All</SelectItem>
              <SelectItem value="In Stock">In Stock</SelectItem>
              <SelectItem value="Ready for Sale">Ready for Sale</SelectItem>
              <SelectItem value="Sold">Sold</SelectItem>
              <SelectItem value="Available">Available</SelectItem>
              <SelectItem value="Rent">Rent</SelectItem>
              <SelectItem value="Faulty">Faulty</SelectItem>
              <SelectItem value="Curitics">Curitics</SelectItem>
              <SelectItem value="Rental">Rental</SelectItem>
              <SelectItem value="DB">DB</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="w-64">
          <Label>Vendor (contains)</Label>
          <Input
            placeholder="Specific vendor name"
            value={vendorFilter}
            onChange={(e) => setVendorFilter(e.target.value)}
          />
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
        }}>
          Clear Filters
        </Button>
      </div>

      {/* Table */}
      <div className="rounded-md border overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="cursor-pointer" onClick={() => handleSort("purchase_date")}>
                Date {sortField === "purchase_date" && (sortOrder === "asc" ? "↑" : "↓")}
              </TableHead>
              <TableHead className="cursor-pointer" onClick={() => handleSort("asset_number")}>
                Asset No {sortField === "asset_number" && (sortOrder === "asc" ? "↑" : "↓")}
              </TableHead>
              <TableHead className="cursor-pointer" onClick={() => handleSort("vendor_name")}>
                Vendor {sortField === "vendor_name" && (sortOrder === "asc" ? "↑" : "↓")}
              </TableHead>
              <TableHead>SKU</TableHead>
              <TableHead>Type</TableHead>
              <TableHead>Description</TableHead>
              <TableHead>Serial No</TableHead>
              <TableHead className="cursor-pointer text-right" onClick={() => handleSort("total_price")}>
                Total Price {sortField === "total_price" && (sortOrder === "asc" ? "↑" : "↓")}
              </TableHead>
              <TableHead className="cursor-pointer" onClick={() => handleSort("stock_status")}>
                Status {sortField === "stock_status" && (sortOrder === "asc" ? "↑" : "↓")}
              </TableHead>
              <TableHead>Purchased By</TableHead>
              <TableHead>Type</TableHead>
              <TableHead>Deleted Remarks</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow>
                <TableCell colSpan={13} className="text-center">Loading…</TableCell>
              </TableRow>
            ) : purchases.length === 0 ? (
              <TableRow>
                <TableCell colSpan={13} className="text-center">No purchases found.</TableCell>
              </TableRow>
            ) : (
              purchases.map((p) => (
                <TableRow key={p.id}>
                  <TableCell>{p.purchase_date?.slice(0,10)}</TableCell>
                  <TableCell>{p.asset_number}</TableCell>
                  <TableCell>{p.vendor_name}</TableCell>
                  <TableCell>{p.sku}</TableCell>
                  <TableCell>{p.type}</TableCell>
                  <TableCell className="max-w-xs truncate">{p.asset_description}</TableCell>
                  <TableCell>{p.serial_number}</TableCell>
                  <TableCell className="text-right">₹{p.total_price?.toFixed(2)}</TableCell>
                  <TableCell>{p.stock_status}</TableCell>
                  <TableCell>{p.purchased_by}</TableCell>
                  <TableCell>{p.purchase_type}</TableCell>
                  <TableCell>{p.deleted_remarks}</TableCell>
                  <TableCell className="text-right space-x-2">
                    {p.is_deleted ? (
                      <>
                        <Button variant="outline" size="sm" onClick={() => handleEditClick(p)}>Edit</Button>
                        <Button variant="default" size="sm" onClick={() => handleRestore(p)}>Restore</Button>
                      </>
                    ) : (
                      <>
                        <Button variant="outline" size="sm" onClick={() => handleEditClick(p)}>Edit</Button>
                        <Button variant="destructive" size="sm" onClick={() => { setPurchaseToDelete(p); setDeleteDialogOpen(true); }}>Delete</Button>
                      </>
                    )}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

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
    </div>
  );
}