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
import AddExpenseDialog from "@/components/AddExpenseDialog";
import BulkAddDialog from "@/components/BulkAddDialog";
import EditExpenseDialog from "@/components/EditExpenseDialog";
import DeleteRecordDialog from "@/components/DeleteRecordDialog";

type SortField = "expense_date" | "type" | "amount";

export default function ExpensesPage() {
  const [expenses, setExpenses] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingExpense, setEditingExpense] = useState<any | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [expenseToDelete, setExpenseToDelete] = useState<any>(null);
  const [showDeleted, setShowDeleted] = useState(false);
  const [searchTerm, setSearchTerm] = useState(""); // GLOBAL SEARCH
  const supabase = createClient();

  const [typeFilter, setTypeFilter] = useState<string>("all");
  const [dateFrom, setDateFrom] = useState<Date | undefined>(undefined);
  const [dateTo, setDateTo] = useState<Date | undefined>(undefined);
  const [sortField, setSortField] = useState<SortField>("expense_date");
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">("desc");

  const fetchExpenses = useCallback(async () => {
    setLoading(true);
    let query = supabase.from("expenses").select("*");

    if (showDeleted) query = query.eq("is_deleted", true);
    else query = query.eq("is_deleted", false);

    // GLOBAL SEARCH across multiple columns
    if (searchTerm) {
      query = query.or(
        `description.ilike.%${searchTerm}%,` +
        `type.ilike.%${searchTerm}%,` +
        `from_location.ilike.%${searchTerm}%,` +
        `to_location.ilike.%${searchTerm}%,` +
        `remarks.ilike.%${searchTerm}%`
      );
    }

    if (typeFilter && typeFilter !== "all") query = query.eq("type", typeFilter);
    if (dateFrom) query = query.gte("expense_date", format(dateFrom, "yyyy-MM-dd"));
    if (dateTo) query = query.lte("expense_date", format(dateTo, "yyyy-MM-dd"));

    query = query.order(sortField, { ascending: sortOrder === "asc" });

    const { data, error } = await query;
    if (error) console.error(error);
    else setExpenses(data || []);
    setLoading(false);
  }, [showDeleted, searchTerm, typeFilter, dateFrom, dateTo, sortField, sortOrder, supabase]);

  useEffect(() => { fetchExpenses(); }, [fetchExpenses]);

  const handleSort = (field: SortField) => {
    if (sortField === field) setSortOrder(sortOrder === "asc" ? "desc" : "asc");
    else { setSortField(field); setSortOrder("asc"); }
  };

  const handleEditClick = (e: any) => { setEditingExpense(e); setDialogOpen(true); };
  const handleSoftDelete = async (remarks: string) => {
    if (!expenseToDelete) return;
    await supabase.from("expenses").update({ is_deleted: true, deleted_remarks: remarks, deleted_at: new Date().toISOString() }).eq("id", expenseToDelete.id);
    fetchExpenses();
    setExpenseToDelete(null);
  };
  const handleRestore = async (e: any) => {
    await supabase.from("expenses").update({ is_deleted: false, deleted_remarks: null, deleted_at: null }).eq("id", e.id);
    fetchExpenses();
  };

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <h1 className="text-2xl font-bold">Expenses</h1>
        <div className="space-x-2">
          <AddExpenseDialog onAdd={fetchExpenses} />
          <BulkAddDialog
            tableName="expenses"
            onAdd={fetchExpenses}
            transformRow={(row: any) => ({
              expense_date: row.expense_date,
              description: row.description,
              type: row.type,
              from_location: row.from_location,
              to_location: row.to_location,
              amount: row.amount ? parseFloat(row.amount) : null,
              remarks: row.remarks,
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
            placeholder="Description, type, location..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
        </div>

        <div className="w-48">
          <Label>Type</Label>
          <Select value={typeFilter} onValueChange={setTypeFilter}>
            <SelectTrigger><SelectValue placeholder="All types" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All</SelectItem>
              <SelectItem value="Food">Food</SelectItem>
              <SelectItem value="Transport">Transport</SelectItem>
              <SelectItem value="Stationary">Stationary</SelectItem>
              <SelectItem value="Water">Water</SelectItem>
              <SelectItem value="Birthday">Birthday</SelectItem>
            </SelectContent>
          </Select>
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

        <Button variant="secondary" onClick={() => { setSearchTerm(""); setTypeFilter("all"); setDateFrom(undefined); setDateTo(undefined); }}>Clear Filters</Button>
      </div>

      {/* Table */}
      <div className="rounded-md border overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="cursor-pointer" onClick={() => handleSort("expense_date")}>Date {sortField === "expense_date" && (sortOrder === "asc" ? "↑" : "↓")}</TableHead>
              <TableHead>Description</TableHead>
              <TableHead className="cursor-pointer" onClick={() => handleSort("type")}>Type {sortField === "type" && (sortOrder === "asc" ? "↑" : "↓")}</TableHead>
              <TableHead>From</TableHead>
              <TableHead>To</TableHead>
              <TableHead className="cursor-pointer text-right" onClick={() => handleSort("amount")}>Amount {sortField === "amount" && (sortOrder === "asc" ? "↑" : "↓")}</TableHead>
              <TableHead>Remarks</TableHead>
              <TableHead>Deleted Remarks</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? <TableRow><TableCell colSpan={9} className="text-center">Loading…</TableCell></TableRow> : expenses.length === 0 ? <TableRow><TableCell colSpan={9} className="text-center">No expenses found.</TableCell></TableRow> : expenses.map((e) => (
              <TableRow key={e.id}>
                <TableCell>{e.expense_date?.slice(0,10)}</TableCell>
                <TableCell>{e.description}</TableCell>
                <TableCell>{e.type}</TableCell>
                <TableCell>{e.from_location}</TableCell>
                <TableCell>{e.to_location}</TableCell>
                <TableCell className="text-right">₹{e.amount?.toFixed(2)}</TableCell>
                <TableCell>{e.remarks}</TableCell>
                <TableCell>{e.deleted_remarks}</TableCell>
                <TableCell className="text-right space-x-2">
                  {e.is_deleted ? (
                    <>
                      <Button variant="outline" size="sm" onClick={() => handleEditClick(e)}>Edit</Button>
                      <Button variant="default" size="sm" onClick={() => handleRestore(e)}>Restore</Button>
                    </>
                  ) : (
                    <>
                      <Button variant="outline" size="sm" onClick={() => handleEditClick(e)}>Edit</Button>
                      <Button variant="destructive" size="sm" onClick={() => { setExpenseToDelete(e); setDeleteDialogOpen(true); }}>Delete</Button>
                    </>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      {editingExpense && <EditExpenseDialog expense={editingExpense} open={dialogOpen} onOpenChange={setDialogOpen} onUpdate={fetchExpenses} />}
      {expenseToDelete && <DeleteRecordDialog title="Delete Expense" identifier={expenseToDelete.description || expenseToDelete.id} open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen} onConfirm={handleSoftDelete} />}
    </div>
  );
}