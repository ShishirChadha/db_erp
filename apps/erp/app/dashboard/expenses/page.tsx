"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { apiFetch } from "@/lib/api-client";
import RequirePageAccess from "@/components/RequirePageAccess";
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
import { CalendarIcon, Loader2 } from "lucide-react";
import { useAsyncAction } from "@/lib/useAsyncAction";
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
import RecurringExpensesManager from "@/components/RecurringExpensesManager";
import StaffReimbursementsManager from "@/components/StaffReimbursementsManager";
import { Badge } from "@/components/ui/badge";
import { useRole } from "@/lib/auth/useRole";
import { useCustomOptions } from "@/lib/useCustomOptions";

type SortField = "expense_date" | "type" | "amount";

function ExpensesPage() {
  const { isOwner, canEditPage } = useRole();
  const canEdit = isOwner || canEditPage("expenses");
  const [expenses, setExpenses] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingExpense, setEditingExpense] = useState<any | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [expenseToDelete, setExpenseToDelete] = useState<any>(null);
  const [showDeleted, setShowDeleted] = useState(false);
  const [searchTerm, setSearchTerm] = useState(""); // GLOBAL SEARCH

  const [typeFilter, setTypeFilter] = useState<string>("all");
  const { values: expenseTypes } = useCustomOptions("expense_types");
  const [dateFrom, setDateFrom] = useState<Date | undefined>(undefined);
  const [dateTo, setDateTo] = useState<Date | undefined>(undefined);
  const [sortField, setSortField] = useState<SortField>("expense_date");
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">("desc");

  const fetchExpenses = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams();
    if (showDeleted) params.set("show_deleted", "true");
    if (searchTerm) params.set("search", searchTerm);
    if (typeFilter && typeFilter !== "all") params.set("type", typeFilter);
    if (dateFrom) params.set("date_from", format(dateFrom, "yyyy-MM-dd"));
    if (dateTo) params.set("date_to", format(dateTo, "yyyy-MM-dd"));
    params.set("sort", sortField);
    params.set("order", sortOrder);

    const res = await apiFetch(`/api/expenses?${params.toString()}`);
    if (!res.ok) console.error(await res.json().catch(() => ({})));
    else setExpenses(await res.json());
    setLoading(false);
  }, [showDeleted, searchTerm, typeFilter, dateFrom, dateTo, sortField, sortOrder]);

  useEffect(() => { fetchExpenses(); }, [fetchExpenses]);

  const handleSort = (field: SortField) => {
    if (sortField === field) setSortOrder(sortOrder === "asc" ? "desc" : "asc");
    else { setSortField(field); setSortOrder("asc"); }
  };

  const handleEditClick = (e: any) => { setEditingExpense(e); setDialogOpen(true); };
  const handleSoftDelete = async (remarks: string) => {
    if (!expenseToDelete) return;
    await apiFetch(`/api/expenses/${expenseToDelete.id}`, { method: "PATCH", body: JSON.stringify({ is_deleted: true, deleted_remarks: remarks }) });
    fetchExpenses();
    setExpenseToDelete(null);
  };

  // Restore acts on one row at a time -- guard re-entrancy per-id so a double
  // click on the same row's Restore button can't fire a duplicate update.
  const [restoringId, setRestoringId] = useState<string | null>(null);
  const restoringRef = useRef<Set<string>>(new Set());
  const handleRestore = async (e: any) => {
    if (restoringRef.current.has(e.id)) return;
    restoringRef.current.add(e.id);
    setRestoringId(e.id);
    try {
      await apiFetch(`/api/expenses/${e.id}`, { method: "PATCH", body: JSON.stringify({ is_deleted: false }) });
      fetchExpenses();
    } finally {
      restoringRef.current.delete(e.id);
      setRestoringId(prev => (prev === e.id ? null : prev));
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <h1 className="text-2xl font-bold">Expenses</h1>
        {canEdit && (
          <div className="space-x-2">
            {isOwner && <RecurringExpensesManager />}
            <StaffReimbursementsManager onSettled={fetchExpenses} />
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
                is_deleted: false,
                payment_account: row.payment_account || null,
                entity_key: row.payment_account ? String(row.payment_account).toLowerCase() : null,
                vendor_id: row.vendor_id || null,
                source: "manual",
                paid_by_staff: row.paid_by_staff || null,
              })}
            />
          </div>
        )}
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
              {expenseTypes.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
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
          <Checkbox id="showDeleted" checked={showDeleted} onCheckedChange={(v) => setShowDeleted(!!v)} />
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
              {isOwner && <TableHead>Vendor</TableHead>}
              <TableHead>Paid By</TableHead>
              <TableHead>Deleted Remarks</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? <TableRow><TableCell colSpan={isOwner ? 10 : 9} className="text-center">Loading…</TableCell></TableRow> : expenses.length === 0 ? <TableRow><TableCell colSpan={isOwner ? 10 : 9} className="text-center">No expenses found.</TableCell></TableRow> : expenses.map((e) => (
              <TableRow key={e.id}>
                <TableCell>{e.expense_date?.slice(0,10)}</TableCell>
                <TableCell>{e.description}</TableCell>
                <TableCell>{e.type}</TableCell>
                <TableCell>{e.from_location}</TableCell>
                <TableCell>{e.to_location}</TableCell>
                <TableCell className="text-right">₹{e.amount?.toFixed(2)}</TableCell>
                {isOwner && <TableCell>{e.vendors?.company_name || "—"}</TableCell>}
                <TableCell>
                  {e.paid_by_staff ? (
                    <span className="flex items-center gap-1.5">
                      {e.paid_by_staff}
                      {e.reimbursement_status === "pending" && <Badge variant="destructive" className="text-xs">Owed</Badge>}
                      {e.reimbursement_status === "partial" && <Badge variant="secondary" className="text-xs">Partial</Badge>}
                      {e.reimbursement_status === "reimbursed" && <Badge variant="outline" className="text-xs">Settled</Badge>}
                    </span>
                  ) : "—"}
                </TableCell>
                <TableCell>{e.deleted_remarks}</TableCell>
                <TableCell className="text-right space-x-2">
                  {canEdit && (e.is_deleted ? (
                    <>
                      <Button variant="outline" size="sm" onClick={() => handleEditClick(e)}>Edit</Button>
                      <Button variant="default" size="sm" onClick={() => handleRestore(e)} disabled={restoringId === e.id}>
                        {restoringId === e.id && <Loader2 className="inline size-3 animate-spin mr-1" />}
                        Restore
                      </Button>
                    </>
                  ) : (
                    <>
                      <Button variant="outline" size="sm" onClick={() => handleEditClick(e)}>Edit</Button>
                      <Button variant="destructive" size="sm" onClick={() => { setExpenseToDelete(e); setDeleteDialogOpen(true); }}>Delete</Button>
                    </>
                  ))}
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

export default function ExpensesPageGuarded() {
  return (
    <RequirePageAccess pageKey="expenses">
      <ExpensesPage />
    </RequirePageAccess>
  );
}