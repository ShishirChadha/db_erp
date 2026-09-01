"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { apiFetch } from "@/lib/api-client";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
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
import { Wallet, Loader2 } from "lucide-react";

const PAYMENT_ACCOUNTS = ["Digitalbluez", "Techtenth", "Cash"];

interface OutstandingExpense {
  id: string;
  expense_date: string;
  description: string;
  type: string;
  amount: number;
  reimbursed_amount: number;
  paid_by_staff: string;
  reimbursement_status: string;
}

// Month-end staff reimbursement clearing. Any role with the 'expenses' edit
// grant can open this (matching the sale_payments "immediately real" posture),
// though in practice the owner is usually the one clearing dues.
export default function StaffReimbursementsManager({ onSettled }: { onSettled: () => void }) {
  const [open, setOpen] = useState(false);
  const [expenses, setExpenses] = useState<OutstandingExpense[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [amounts, setAmounts] = useState<Record<string, string>>({});
  const [paymentAccount, setPaymentAccount] = useState("");
  const [settling, setSettling] = useState(false);
  const [staffFilter, setStaffFilter] = useState<string>("all");

  const fetchOutstanding = useCallback(async () => {
    setLoading(true);
    const res = await apiFetch("/api/expenses");
    if (res.ok) {
      const all: any[] = await res.json();
      const outstanding = all.filter((e) => e.paid_by_staff && (e.reimbursement_status === "pending" || e.reimbursement_status === "partial"));
      setExpenses(outstanding);
      const nextAmounts: Record<string, string> = {};
      for (const e of outstanding) nextAmounts[e.id] = (Number(e.amount) - Number(e.reimbursed_amount)).toFixed(2);
      setAmounts(nextAmounts);
    }
    setLoading(false);
  }, []);

  useEffect(() => { if (open) fetchOutstanding(); }, [open, fetchOutstanding]);

  const staffNames = useMemo(() => [...new Set(expenses.map((e) => e.paid_by_staff))].sort(), [expenses]);
  const visible = staffFilter === "all" ? expenses : expenses.filter((e) => e.paid_by_staff === staffFilter);

  const totalsByStaff = useMemo(() => {
    const totals: Record<string, number> = {};
    for (const e of expenses) totals[e.paid_by_staff] = (totals[e.paid_by_staff] || 0) + (Number(e.amount) - Number(e.reimbursed_amount));
    return totals;
  }, [expenses]);

  const toggleSelected = (id: string) => setSelected((prev) => ({ ...prev, [id]: !prev[id] }));
  const toggleSelectAllVisible = (checked: boolean) => {
    const next: Record<string, boolean> = { ...selected };
    for (const e of visible) next[e.id] = checked;
    setSelected(next);
  };

  const selectedIds = Object.keys(selected).filter((id) => selected[id]);

  const settleSelected = async () => {
    if (selectedIds.length === 0) return;
    setSettling(true);
    try {
      for (const id of selectedIds) {
        const amount = parseFloat(amounts[id] || "0");
        if (!(amount > 0)) continue;
        await apiFetch(`/api/expenses/${id}/reimbursements`, {
          method: "POST",
          body: JSON.stringify({ amount, payment_account: paymentAccount || null }),
        });
      }
      setSelected({});
      await fetchOutstanding();
      onSettled();
    } finally {
      setSettling(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline">
          <Wallet className="mr-2 h-4 w-4" /> Staff Reimbursements
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader><DialogTitle>Staff Reimbursements</DialogTitle></DialogHeader>

        <div className="flex flex-wrap gap-4 items-end pb-2">
          <div className="w-48">
            <Label>Staff</Label>
            <Select value={staffFilter} onValueChange={setStaffFilter}>
              <SelectTrigger><SelectValue placeholder="All staff" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All</SelectItem>
                {staffNames.map((n) => (
                  <SelectItem key={n} value={n}>{n} (₹{totalsByStaff[n]?.toFixed(2)} owed)</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="w-48">
            <Label>Reimbursed From</Label>
            <Select value={paymentAccount} onValueChange={setPaymentAccount}>
              <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
              <SelectContent>{PAYMENT_ACCOUNTS.map((a) => <SelectItem key={a} value={a}>{a}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <Button onClick={settleSelected} disabled={settling || selectedIds.length === 0}>
            {settling && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Settle Selected ({selectedIds.length})
          </Button>
        </div>

        <div className="rounded-md border overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-10">
                  <Checkbox
                    checked={visible.length > 0 && visible.every((e) => selected[e.id])}
                    onCheckedChange={(v) => toggleSelectAllVisible(!!v)}
                  />
                </TableHead>
                <TableHead>Staff</TableHead>
                <TableHead>Date</TableHead>
                <TableHead>Description</TableHead>
                <TableHead className="text-right">Amount</TableHead>
                <TableHead className="text-right">Outstanding</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <TableRow><TableCell colSpan={7} className="text-center">Loading…</TableCell></TableRow>
              ) : visible.length === 0 ? (
                <TableRow><TableCell colSpan={7} className="text-center">Nothing outstanding.</TableCell></TableRow>
              ) : visible.map((e) => (
                <TableRow key={e.id}>
                  <TableCell><Checkbox checked={!!selected[e.id]} onCheckedChange={() => toggleSelected(e.id)} /></TableCell>
                  <TableCell>{e.paid_by_staff}</TableCell>
                  <TableCell>{e.expense_date?.slice(0, 10)}</TableCell>
                  <TableCell>{e.description}</TableCell>
                  <TableCell className="text-right tabular-nums">₹{Number(e.amount).toFixed(2)}</TableCell>
                  <TableCell className="text-right">
                    <Input
                      type="number"
                      step="0.01"
                      className="w-24 h-8 text-right ml-auto"
                      value={amounts[e.id] ?? ""}
                      onChange={(ev) => setAmounts((prev) => ({ ...prev, [e.id]: ev.target.value }))}
                    />
                  </TableCell>
                  <TableCell><Badge variant={e.reimbursement_status === "partial" ? "secondary" : "destructive"} className="text-xs">{e.reimbursement_status}</Badge></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </DialogContent>
    </Dialog>
  );
}
