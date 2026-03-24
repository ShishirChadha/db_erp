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
import { Plus, Search, Eye, Loader2, Star } from 'lucide-react'

type Customer = {
  id: string
  customer_name: string
  type: string
  has_gst: boolean
  gst_number: string
  address: string
  phone: string
  email: string
  source: string
  google_review: boolean
  social_following: string
  created_at: string
}

const SOURCES = [
  'Walk-in', 'Referral', 'Instagram', 'Facebook',
  'Google', 'JustDial', 'OLX', 'IndiaMART', 'Other'
]

const emptyForm = {
  customer_name: '',
  type: '',
  has_gst: 'false',
  gst_number: '',
  address: '',
  phone: '',
  email: '',
  source: '',
  google_review: 'false',
  social_following: '',
}

export default function CustomersClient({ initialData }: { initialData: Customer[] }) {
  const [customers, setCustomers] = useState<Customer[]>(initialData)
  const [search, setSearch] = useState('')
  const [showForm, setShowForm] = useState(false)
  const [viewItem, setViewItem] = useState<Customer | null>(null)
  const [form, setForm] = useState(emptyForm)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const supabase = createClient()

  const handleSubmit = async () => {
    setError('')
    if (!form.customer_name) {
      setError('Customer Name is required.')
      return
    }
    setLoading(true)

    const { data, error: err } = await supabase
      .from('customers')
      .insert([{
        ...form,
        has_gst: form.has_gst === 'true',
        google_review: form.google_review === 'true',
      }])
      .select()
      .single()

    if (err) {
      setError(err.message)
      setLoading(false)
      return
    }

    setCustomers([data, ...customers])
    setForm(emptyForm)
    setShowForm(false)
    setLoading(false)
  }

  const filtered = customers.filter(c =>
    c.customer_name?.toLowerCase().includes(search.toLowerCase()) ||
    c.phone?.toLowerCase().includes(search.toLowerCase()) ||
    c.email?.toLowerCase().includes(search.toLowerCase()) ||
    c.source?.toLowerCase().includes(search.toLowerCase())
  )

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">Customer Base</h1>
          <p className="text-sm text-gray-500 mt-1">{customers.length} total customers</p>
        </div>
        <Button
          className="bg-blue-600 hover:bg-blue-700"
          onClick={() => setShowForm(true)}
        >
          <Plus className="h-4 w-4 mr-2" />
          Add Customer
        </Button>
      </div>

      {/* Search */}
      <div className="relative mb-4">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
        <Input
          placeholder="Search by name, phone, email, source..."
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
                  <th className="text-left px-4 py-3 font-medium text-gray-600">Name</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-600">Type</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-600">Phone</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-600">Email</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-600">Source</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-600">GST</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-600">Review</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-600">Social</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-600"></th>
                </tr>
              </thead>
              <tbody>
                {filtered.length === 0 ? (
                  <tr>
                    <td colSpan={9} className="text-center py-12 text-gray-400">
                      No customers found. Click "Add Customer" to get started.
                    </td>
                  </tr>
                ) : (
                  filtered.map((c) => (
                    <tr
                      key={c.id}
                      className="border-b border-gray-100 hover:bg-gray-50 transition-colors"
                    >
                      <td className="px-4 py-3 font-medium">{c.customer_name}</td>
                      <td className="px-4 py-3">
                        <Badge
                          className={
                            c.type === 'Business'
                              ? 'bg-blue-100 text-blue-700 hover:bg-blue-100'
                              : 'bg-gray-100 text-gray-700 hover:bg-gray-100'
                          }
                        >
                          {c.type || '—'}
                        </Badge>
                      </td>
                      <td className="px-4 py-3 text-gray-600">{c.phone || '—'}</td>
                      <td className="px-4 py-3 text-gray-600">{c.email || '—'}</td>
                      <td className="px-4 py-3 text-gray-600">{c.source || '—'}</td>
                      <td className="px-4 py-3">
                        {c.has_gst ? (
                          <Badge className="bg-green-100 text-green-700 hover:bg-green-100">Yes</Badge>
                        ) : (
                          <Badge className="bg-gray-100 text-gray-500 hover:bg-gray-100">No</Badge>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        {c.google_review ? (
                          <Star className="h-4 w-4 text-yellow-500 fill-yellow-500" />
                        ) : (
                          <Star className="h-4 w-4 text-gray-300" />
                        )}
                      </td>
                      <td className="px-4 py-3">
                        {c.social_following && c.social_following !== 'None' ? (
                          <Badge className="bg-pink-100 text-pink-700 hover:bg-pink-100">
                            {c.social_following}
                          </Badge>
                        ) : '—'}
                      </td>
                      <td className="px-4 py-3">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setViewItem(c)}
                        >
                          <Eye className="h-4 w-4" />
                        </Button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {/* Add Customer Dialog */}
      <Dialog open={showForm} onOpenChange={setShowForm}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Add New Customer</DialogTitle>
          </DialogHeader>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-2">

            <div className="space-y-2 md:col-span-2">
              <Label>Customer Name *</Label>
              <Input
                placeholder="Enter full name or company name"
                value={form.customer_name}
                onChange={(e) => setForm({ ...form, customer_name: e.target.value })}
              />
            </div>

            <div className="space-y-2">
              <Label>Type</Label>
              <Select onValueChange={(v) => setForm({ ...form, type: v })}>
                <SelectTrigger>
                  <SelectValue placeholder="Business or Individual" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="Business">Business</SelectItem>
                  <SelectItem value="Individual">Individual</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>Has GST?</Label>
              <Select onValueChange={(v) => setForm({ ...form, has_gst: v })}>
                <SelectTrigger>
                  <SelectValue placeholder="Yes or No" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="true">Yes</SelectItem>
                  <SelectItem value="false">No</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {form.has_gst === 'true' && (
              <div className="space-y-2 md:col-span-2">
                <Label>GST Number</Label>
                <Input
                  placeholder="e.g. 07AAAAA0000A1Z5"
                  value={form.gst_number}
                  onChange={(e) => setForm({ ...form, gst_number: e.target.value })}
                />
              </div>
            )}

            <div className="space-y-2">
              <Label>Phone</Label>
              <Input
                placeholder="+91 98765 43210"
                value={form.phone}
                onChange={(e) => setForm({ ...form, phone: e.target.value })}
              />
            </div>

            <div className="space-y-2">
              <Label>Email</Label>
              <Input
                type="email"
                placeholder="customer@email.com"
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
              />
            </div>

            <div className="space-y-2 md:col-span-2">
              <Label>Address</Label>
              <Input
                placeholder="Full address"
                value={form.address}
                onChange={(e) => setForm({ ...form, address: e.target.value })}
              />
            </div>

            <div className="space-y-2">
              <Label>Source</Label>
              <Select onValueChange={(v) => setForm({ ...form, source: v })}>
                <SelectTrigger>
                  <SelectValue placeholder="How did they find you?" />
                </SelectTrigger>
                <SelectContent>
                  {SOURCES.map(s => (
                    <SelectItem key={s} value={s}>{s}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>Social Following</Label>
              <Select onValueChange={(v) => setForm({ ...form, social_following: v })}>
                <SelectTrigger>
                  <SelectValue placeholder="FB, Insta or Both?" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="FB">Facebook</SelectItem>
                  <SelectItem value="Insta">Instagram</SelectItem>
                  <SelectItem value="Both">Both</SelectItem>
                  <SelectItem value="None">None</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2 md:col-span-2">
              <Label>Left Google Review?</Label>
              <Select onValueChange={(v) => setForm({ ...form, google_review: v })}>
                <SelectTrigger>
                  <SelectValue placeholder="Has this customer reviewed you?" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="true">Yes — has reviewed</SelectItem>
                  <SelectItem value="false">No — not yet</SelectItem>
                </SelectContent>
              </Select>
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
                'Save Customer'
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

      {/* View Customer Detail Dialog */}
      <Dialog open={!!viewItem} onOpenChange={() => setViewItem(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{viewItem?.customer_name}</DialogTitle>
          </DialogHeader>

          {viewItem && (
            <div className="grid grid-cols-2 gap-x-8 gap-y-3 mt-2 text-sm">
              {[
                ['Type', viewItem.type],
                ['Phone', viewItem.phone],
                ['Email', viewItem.email],
                ['Address', viewItem.address],
                ['Source', viewItem.source],
                ['GST', viewItem.has_gst ? `Yes — ${viewItem.gst_number}` : 'No'],
                ['Google Review', viewItem.google_review ? 'Yes ⭐' : 'Not yet'],
                ['Social Following', viewItem.social_following],
              ].map(([label, value]) => (
                <div key={label}>
                  <p className="text-gray-400 text-xs">{label}</p>
                  <p className="font-medium text-gray-900 mt-0.5">{value || '—'}</p>
                </div>
              ))}
            </div>
          )}

        </DialogContent>
      </Dialog>

    </div>
  )
}