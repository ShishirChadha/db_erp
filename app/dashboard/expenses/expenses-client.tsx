'use client'

import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Plus, Search, Loader2 } from 'lucide-react'

type Expense = {
  id: string
  expense_date: string
  description: string
  type: string
  from_location: string
  to_location: string
  amount: number
  remarks: string
  created_at: string
}

const EXPENSE_TYPES = ['Food', 'Transport', 'Stationary', 'Water', 'Birthday']

const TYPE_COLORS: Record<string, string> = {
  Food:       'bg-orange-100 text-orange-700',
  Transport:  'bg-blue-100 text-blue-700',
  Stationary: 'bg-purple-100 text-purple-700',
  Water:      'bg-cyan-100 text-cyan-700',
  Birthday:   'bg-pink-100 text-pink-700',
}

const emptyForm = {
  expense_date: '',
  description: '',
  type: '',
  from_location: '',
  to_location: '',
  amount: '',
  remarks: '',
}

export default function ExpensesClient({ initialData }: { initialData: Expense[] }) {
  const [expenses, setExpenses] = useState<Expense[]>(initialData)
  const [search, setSearch] = useState('')
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState(emptyForm)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const supabase = createClient()

  const totalAmount = expenses.reduce((sum, e) => sum + (e.amount || 0), 0)

  const handleSubmit = async () => {
    setError('')
    if (!form.expense_date || !form.description || !form.amount) {
      setError('Date, Description and Amount are required.')
      return
    }
    setLoading(true)

    const { data, error: err } = await supabase
      .from('expenses')
      .insert([{
        ...form,
        amount: parseFloat(form.amount as string) || 0,
      }])
      .select()
      .single()

    if (err) {
      setError(err.message)
      setLoading(false)
      return
    }

    setExpenses([data, ...expenses])
    setForm(emptyForm)
    setShowForm(false)
    setLoading(false)
  }

  const filtered = expenses.filter(e =>
    e.description?.toLowerCase().includes(search.toLowerCase()) ||
    e.type?.toLowerCase().includes(search.toLowerCase()) ||
    e.remarks?.toLowerCase().includes(search.toLowerCase())
  )

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">Expenses</h1>
          <p className="text-sm text-gray-500 mt-1">
            {expenses.length} records · Total: ₹{totalAmount.toLocaleString('en-IN')}
          </p>
        </div>
        <Button
          className="bg-blue-600 hover:bg-blue-700"
          onClick={() => setShowForm(true)}
        >
          <Plus className="h-4 w-4 mr-2" />
          Add Expense
        </Button>
      </div>

      {/* Summary cards by type */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-6">
        {EXPENSE_TYPES.map(type => {
          const total = expenses
            .filter(e => e.type === type)
            .reduce((sum, e) => sum + (e.amount || 0), 0)
          return (
            <div
              key={type}
              className="bg-white rounded-xl border border-gray-200 p-3"
            >
              <p className="text-xs text-gray-500">{type}</p>
              <p className="text-lg font-semibold text-gray-900 mt-1">
                ₹{total.toLocaleString('en-IN')}
              </p>
            </div>
          )
        })}
      </div>

      {/* Search */}
      <div className="relative mb-4">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
        <Input
          placeholder="Search by description, type, remarks..."
          className="pl-9"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      {/* Table */}
      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200 bg-gray-50">
                  <th className="text-left px-4 py-3 font-medium text-gray-600">Date</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-600">Description</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-600">Type</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-600">From</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-600">To</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-600">Amount</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-600">Remarks</th>
                </tr>
              </thead>
              <tbody>
                {filtered.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="text-center py-12 text-gray-400">
                      No expenses found. Click "Add Expense" to get started.
                    </td>
                  </tr>
                ) : (
                  filtered.map((e) => (
                    <tr
                      key={e.id}
                      className="border-b border-gray-100 hover:bg-gray-50 transition-colors"
                    >
                      <td className="px-4 py-3 text-gray-600">{e.expense_date}</td>
                      <td className="px-4 py-3 font-medium">{e.description}</td>
                      <td className="px-4 py-3">
                        <Badge className={`${TYPE_COLORS[e.type] || 'bg-gray-100 text-gray-700'} hover:opacity-80`}>
                          {e.type}
                        </Badge>
                      </td>
                      <td className="px-4 py-3 text-gray-600">{e.from_location || '—'}</td>
                      <td className="px-4 py-3 text-gray-600">{e.to_location || '—'}</td>
                      <td className="px-4 py-3 font-medium text-red-600">
                        ₹{e.amount?.toLocaleString('en-IN')}
                      </td>
                      <td className="px-4 py-3 text-gray-500">{e.remarks || '—'}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {/* Add Expense Dialog */}
      <Dialog open={showForm} onOpenChange={setShowForm}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Add New Expense</DialogTitle>
          </DialogHeader>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-2">

            <div className="space-y-2">
              <Label>Date *</Label>
              <Input
                type="date"
                value={form.expense_date}
                onChange={(e) => setForm({ ...form, expense_date: e.target.value })}
              />
            </div>

            <div className="space-y-2">
              <Label>Type</Label>
              <Select onValueChange={(v) => setForm({ ...form, type: v })}>
                <SelectTrigger>
                  <SelectValue placeholder="Select type" />
                </SelectTrigger>
                <SelectContent>
                  {EXPENSE_TYPES.map(t => (
                    <SelectItem key={t} value={t}>{t}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2 md:col-span-2">
              <Label>Description *</Label>
              <Input
                placeholder="e.g. Team lunch at restaurant"
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
              />
            </div>

            <div className="space-y-2">
              <Label>From</Label>
              <Input
                placeholder="e.g. Office"
                value={form.from_location}
                onChange={(e) => setForm({ ...form, from_location: e.target.value })}
              />
            </div>

            <div className="space-y-2">
              <Label>To</Label>
              <Input
                placeholder="e.g. Client site"
                value={form.to_location}
                onChange={(e) => setForm({ ...form, to_location: e.target.value })}
              />
            </div>

            <div className="space-y-2">
              <Label>Amount (₹) *</Label>
              <Input
                type="number"
                placeholder="0.00"
                value={form.amount}
                onChange={(e) => setForm({ ...form, amount: e.target.value })}
              />
            </div>

            <div className="space-y-2">
              <Label>Remarks</Label>
              <Input
                placeholder="Any notes"
                value={form.remarks}
                onChange={(e) => setForm({ ...form, remarks: e.target.value })}
              />
            </div>

          </div>

          {error && (
            <div className="bg-red-50 text-red-600 text-sm px-4 py-3 rounded-lg mt-2">
              {error}
            </div>
          )}

          <div className="flex gap-3 mt-4">
            <Button
              className="flex-1 bg-blue-600 hover:bg-blue-700"
              onClick={handleSubmit}
              disabled={loading}
            >
              {loading ? (
                <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Saving...</>
              ) : (
                'Save Expense'
              )}
            </Button>
            <Button
              variant="outline"
              onClick={() => { setShowForm(false); setError('') }}
            >
              Cancel
            </Button>
          </div>

        </DialogContent>
      </Dialog>

    </div>
  )
}