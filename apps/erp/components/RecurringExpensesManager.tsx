"use client";

import { useState, useEffect, useCallback } from "react";
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
import { Repeat } from "lucide-react";
import { useAsyncAction } from "@/lib/useAsyncAction";
import { useCustomOptions } from "@/lib/useCustomOptions";
import { SearchableSelect } from "@/components/SearchableSelect";

const PAYMENT_ACCOUNTS = ["Digitalbluez", "Techtenth", "Cash"];
const INTERVAL_UNITS = ["weekly", "monthly", "yearly"];

interface Rule {
  id: string;
  type: string;
  description: string | null;
  payment_account: string;
  interval_unit: string;
  next_due_date: string;
  reminder_lead_days: number;
  expected_amount: number | null;
  is_active: boolean;
  vendors?: { company_name: string } | null;
}

const emptyForm = {
  type: "",
  description: "",
  payment_account: "",
  interval_unit: "monthly",
  next_due_date: "",
  reminder_lead_days: 3,
  expected_amount: null as number | null,
};

// Owner-only rule manager reachable from the Expenses page -- a rule due within
// its lead window gets a real activities-task reminder via the scan_recurring_expenses()
// cron function, replacing the old passive bank-recon-only watch.
export default function RecurringExpensesManager() {
  const [open, setOpen] = useState(false);
  const [rules, setRules] = useState<Rule[]>([]);
  const [loading, setLoading] = useState(true);
  const [formData, setFormData] = useState(emptyForm);
  const { values: expenseTypes, addOption: addExpenseType } = useCustomOptions("expense_types");

  const fetchRules = useCallback(async () => {
    setLoading(true);
    const res = await apiFetch("/api/recurring-expenses");
    if (res.ok) setRules(await res.json());
    setLoading(false);
  }, []);

  useEffect(() => { if (open) fetchRules(); }, [open, fetchRules]);

  const handleChange = (field: string, value: string | number | null) => {
    setFormData((prev) => ({ ...prev, [field]: value }));
  };

  const { run: handleSubmit, pending: saving } = useAsyncAction(async (e: React.FormEvent) => {
    e.preventDefault();
    const res = await apiFetch("/api/recurring-expenses", { method: "POST", body: JSON.stringify(formData) });
    if (!res.ok) {
      alert((await res.json().catch(() => ({}))).error || "Failed to add rule.");
    } else {
      setFormData(emptyForm);
      fetchRules();
    }
  });

  const toggleActive = async (rule: Rule) => {
    await apiFetch(`/api/recurring-expenses/${rule.id}`, { method: "PATCH", body: JSON.stringify({ is_active: !rule.is_active }) });
    fetchRules();
  };

  const removeRule = async (rule: Rule) => {
    if (!confirm(`Remove the recurring rule for "${rule.type}"?`)) return;
    await apiFetch(`/api/recurring-expenses/${rule.id}`, { method: "DELETE" });
    fetchRules();
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline">
          <Repeat className="mr-2 h-4 w-4" /> Recurring Expenses
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader><DialogTitle>Recurring Expenses</DialogTitle></DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-3 border-b pb-4">
          <div className="grid grid-cols-3 gap-3">
            <div>
              <Label>Type</Label>
              <SearchableSelect
                options={expenseTypes}
                value={formData.type}
                onChange={(val) => handleChange("type", val)}
                placeholder="Select type..."
                onOtherCommit={(val) => addExpenseType(val)}
              />
            </div>
            <div>
              <Label>Entity</Label>
              <Select value={formData.payment_account} onValueChange={(val) => handleChange("payment_account", val)}>
                <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
                <SelectContent>{PAYMENT_ACCOUNTS.map((a) => <SelectItem key={a} value={a}>{a}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div>
              <Label>Interval</Label>
              <Select value={formData.interval_unit} onValueChange={(val) => handleChange("interval_unit", val)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{INTERVAL_UNITS.map((u) => <SelectItem key={u} value={u}>{u}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div>
              <Label>Next Due Date</Label>
              <Input type="date" required value={formData.next_due_date} onChange={(e) => handleChange("next_due_date", e.target.value)} />
            </div>
            <div>
              <Label>Remind (days before)</Label>
              <Input type="number" value={formData.reminder_lead_days} onChange={(e) => handleChange("reminder_lead_days", parseInt(e.target.value) || 0)} />
            </div>
            <div>
              <Label>Expected Amount</Label>
              <Input type="number" step="0.01" value={formData.expected_amount ?? ""} onChange={(e) => handleChange("expected_amount", e.target.value === "" ? null : parseFloat(e.target.value))} />
            </div>
            <div className="col-span-3">
              <Label>Description</Label>
              <Input value={formData.description} onChange={(e) => handleChange("description", e.target.value)} />
            </div>
          </div>
          <div className="flex justify-end">
            <Button type="submit" loading={saving} disabled={!formData.type || !formData.payment_account || !formData.next_due_date}>
              Add Rule
            </Button>
          </div>
        </form>

        <div className="rounded-md border overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Type</TableHead>
                <TableHead>Entity</TableHead>
                <TableHead>Interval</TableHead>
                <TableHead>Next Due</TableHead>
                <TableHead>Active</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <TableRow><TableCell colSpan={6} className="text-center">Loading…</TableCell></TableRow>
              ) : rules.length === 0 ? (
                <TableRow><TableCell colSpan={6} className="text-center">No recurring rules yet.</TableCell></TableRow>
              ) : rules.map((r) => (
                <TableRow key={r.id}>
                  <TableCell>{r.type}</TableCell>
                  <TableCell>{r.payment_account}</TableCell>
                  <TableCell>{r.interval_unit}</TableCell>
                  <TableCell>{r.next_due_date}</TableCell>
                  <TableCell>{r.is_active ? "Yes" : "No"}</TableCell>
                  <TableCell className="text-right space-x-2">
                    <Button variant="outline" size="sm" onClick={() => toggleActive(r)}>{r.is_active ? "Pause" : "Resume"}</Button>
                    <Button variant="destructive" size="sm" onClick={() => removeRule(r)}>Delete</Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </DialogContent>
    </Dialog>
  );
}
