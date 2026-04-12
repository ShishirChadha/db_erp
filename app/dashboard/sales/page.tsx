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
import AddSaleDialog from "@/components/AddSaleDialog";
import BulkAddDialog from "@/components/BulkAddDialog";
import EditSaleDialog from "@/components/EditSaleDialog";
import DeleteRecordDialog from "@/components/DeleteRecordDialog";

type SortField = "sale_date" | "invoice_number" | "customer_name" | "sale_total" | "sale_type";
type SortOrder = "asc" | "desc";

export default function SalesPage() {
  const [sales, setSales] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingSale, setEditingSale] = useState<any | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [saleToDelete, setSaleToDelete] = useState<any>(null);
  const [showDeleted, setShowDeleted] = useState(false);
  const [searchTerm, setSearchTerm] = useState(""); // GLOBAL SEARCH
  const supabase = createClient();

  const [typeFilter, setTypeFilter] = useState<string>("all");
  const [customerFilter, setCustomerFilter] = useState<string>("");
  const [dateFrom, setDateFrom] = useState<Date | undefined>(undefined);
  const [dateTo, setDateTo] = useState<Date | undefined>(undefined);
  const [sortField, setSortField] = useState<SortField>("sale_date");
  const [sortOrder, setSortOrder] = useState<SortOrder>("desc");

  const fetchSales = useCallback(async () => {
    setLoading(true);
    let query = supabase.from("sales").select("*");

    if (showDeleted) {
      query = query.eq("is_deleted", true);
    } else {
      query = query.eq("is_deleted", false);
    }

    // GLOBAL SEARCH across multiple columns
    if (searchTerm) {
      query = query.or(
        `invoice_number.ilike.%${searchTerm}%,` +
        `customer_name.ilike.%${searchTerm}%,` +
        `asset_number.ilike.%${searchTerm}%,` +
        `sku.ilike.%${searchTerm}%,` +
        `type.ilike.%${searchTerm}%,` +
        `asset_description.ilike.%${searchTerm}%,` +
        `serial_number.ilike.%${searchTerm}%,` +
        `sale_type.ilike.%${searchTerm}%`
      );
    }

    if (typeFilter && typeFilter !== "all") {
      query = query.eq("sale_type", typeFilter);
    }
    if (customerFilter) {
      query = query.ilike("customer_name", `%${customerFilter}%`);
    }
    if (dateFrom) query = query.gte("sale_date", format(dateFrom, "yyyy-MM-dd"));
    if (dateTo) query = query.lte("sale_date", format(dateTo, "yyyy-MM-dd"));

    query = query.order(sortField, { ascending: sortOrder === "asc" });

    const { data, error } = await query;
    if (error) console.error(error);
    else setSales(data || []);
    setLoading(false);
  }, [showDeleted, searchTerm, typeFilter, customerFilter, dateFrom, dateTo, sortField, sortOrder, supabase]);

  useEffect(() => { fetchSales(); }, [fetchSales]);

  const handleSort = (field: SortField) => {
    if (sortField === field) setSortOrder(sortOrder === "asc" ? "desc" : "asc");
    else { setSortField(field); setSortOrder("asc"); }
  };

  const handleEditClick = (sale: any) => {
    setEditingSale(sale);
    setDialogOpen(true);
  };

  const handleSoftDelete = async (remarks: string) => {
    if (!saleToDelete) return;
    const { error } = await supabase
      .from("sales")
      .update({ is_deleted: true, deleted_remarks: remarks, deleted_at: new Date().toISOString() })
      .eq("id", saleToDelete.id);
    if (error) console.error(error);
    else fetchSales();
    setSaleToDelete(null);
  };

  const handleRestore = async (sale: any) => {
    await supabase
      .from("sales")
      .update({ is_deleted: false, deleted_remarks: null, deleted_at: null })
      .eq("id", sale.id);
    fetchSales();
  };

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <h1 className="text-2xl font-bold">Sales</h1>
        <div className="space-x-2">
          <AddSaleDialog onAdd={fetchSales} />
          <BulkAddDialog
            tableName="sales"
            onAdd={fetchSales}
            transformRow={(row: any) => ({
              sale_date: row.sale_date,
              invoice_number: row.invoice_number,
              customer_name: row.customer_name,
              asset_number: row.asset_number,
              sku: row.sku,
              type: row.type,
              asset_description: row.asset_description,
              serial_number: row.serial_number,
              sale_base_price: row.sale_base_price ? parseFloat(row.sale_base_price) : null,
              sale_gst: row.sale_gst ? parseFloat(row.sale_gst) : null,
              sale_total: row.sale_total ? parseFloat(row.sale_total) : null,
              sale_type: row.sale_type,
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
            placeholder="Invoice, customer, asset, serial..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
        </div>

        <div className="w-48">
          <Label>Sale Type</Label>
          <Select value={typeFilter} onValueChange={setTypeFilter}>
            <SelectTrigger><SelectValue placeholder="All types" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All</SelectItem>
              <SelectItem value="GST">GST</SelectItem>
              <SelectItem value="Cash">Cash</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="w-64">
          <Label>Customer Name</Label>
          <Input placeholder="Search customer" value={customerFilter} onChange={(e) => setCustomerFilter(e.target.value)} />
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
          setTypeFilter("all");
          setCustomerFilter("");
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
              <TableHead className="cursor-pointer" onClick={() => handleSort("sale_date")}>Date {sortField === "sale_date" && (sortOrder === "asc" ? "↑" : "↓")}</TableHead>
              <TableHead className="cursor-pointer" onClick={() => handleSort("invoice_number")}>Invoice No {sortField === "invoice_number" && (sortOrder === "asc" ? "↑" : "↓")}</TableHead>
              <TableHead className="cursor-pointer" onClick={() => handleSort("customer_name")}>Customer {sortField === "customer_name" && (sortOrder === "asc" ? "↑" : "↓")}</TableHead>
              <TableHead>Asset No</TableHead>
              <TableHead>SKU</TableHead>
              <TableHead>Description</TableHead>
              <TableHead>Serial No</TableHead>
              <TableHead className="cursor-pointer text-right" onClick={() => handleSort("sale_total")}>Total {sortField === "sale_total" && (sortOrder === "asc" ? "↑" : "↓")}</TableHead>
              <TableHead className="cursor-pointer" onClick={() => handleSort("sale_type")}>Type {sortField === "sale_type" && (sortOrder === "asc" ? "↑" : "↓")}</TableHead>
              <TableHead>Deleted Remarks</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? <TableRow><TableCell colSpan={11} className="text-center">Loading…</TableCell></TableRow> : sales.length === 0 ? <TableRow><TableCell colSpan={11} className="text-center">No sales found.</TableCell></TableRow> : sales.map((s) => (
              <TableRow key={s.id}>
                <TableCell>{s.sale_date?.slice(0,10)}</TableCell>
                <TableCell>{s.invoice_number}</TableCell>
                <TableCell>{s.customer_name}</TableCell>
                <TableCell>{s.asset_number}</TableCell>
                <TableCell>{s.sku}</TableCell>
                <TableCell className="max-w-xs truncate">{s.asset_description}</TableCell>
                <TableCell>{s.serial_number}</TableCell>
                <TableCell className="text-right">₹{s.sale_total?.toFixed(2)}</TableCell>
                <TableCell>{s.sale_type}</TableCell>
                <TableCell>{s.deleted_remarks}</TableCell>
                <TableCell className="text-right space-x-2">
                  {s.is_deleted ? (
                    <>
                      <Button variant="outline" size="sm" onClick={() => handleEditClick(s)}>Edit</Button>
                      <Button variant="default" size="sm" onClick={() => handleRestore(s)}>Restore</Button>
                    </>
                  ) : (
                    <>
                      <Button variant="outline" size="sm" onClick={() => handleEditClick(s)}>Edit</Button>
                      <Button variant="destructive" size="sm" onClick={() => { setSaleToDelete(s); setDeleteDialogOpen(true); }}>Delete</Button>
                    </>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      {editingSale && <EditSaleDialog sale={editingSale} open={dialogOpen} onOpenChange={setDialogOpen} onUpdate={fetchSales} />}
      {saleToDelete && <DeleteRecordDialog title="Delete Sale" identifier={saleToDelete.invoice_number} open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen} onConfirm={handleSoftDelete} />}
    </div>
  );
}