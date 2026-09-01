'use client'

import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Checkbox } from '@/components/ui/checkbox'
import { Textarea } from '@/components/ui/textarea'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

export interface VendorFormState {
  company_name: string
  spoc_name: string
  owner_name: string
  phone: string
  alt_phone: string
  address_line1: string
  address_line2: string
  city: string
  state: string
  pincode: string
  email: string
  has_gst: string // 'true' | 'false' -- matches the Select's string value, not a real boolean
  gst_number: string
  gst_company_name: string
  remarks: string
  supplies_accessories: boolean
}

export const emptyVendorForm: VendorFormState = {
  company_name: '',
  spoc_name: '',
  owner_name: '',
  phone: '',
  alt_phone: '',
  address_line1: '',
  address_line2: '',
  city: '',
  state: '',
  pincode: '',
  email: '',
  has_gst: 'false',
  gst_number: '',
  gst_company_name: '',
  remarks: '',
  supplies_accessories: false,
}

// Shared by the owner's Vendors page (full form, with the supplies_accessories toggle)
// and the employee-facing "Add new vendor" dialog inside Receive Stock (same fields,
// minus that toggle -- an employee-created vendor is always accessory-tagged server-side,
// not their call to leave untagged). See docs/decisions.md, 2026-08-24.
export function VendorFormFields({
  form,
  onChange,
  fetchingGst,
  onGstBlur,
  showSuppliesAccessories = false,
}: {
  form: VendorFormState
  onChange: (patch: Partial<VendorFormState>) => void
  fetchingGst: boolean
  onGstBlur: () => void
  showSuppliesAccessories?: boolean
}) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-2">
      <div className="space-y-2 md:col-span-2">
        <Label>Company Name *</Label>
        <Input
          placeholder="e.g. Tech Traders Pvt Ltd"
          value={form.company_name}
          onChange={(e) => onChange({ company_name: e.target.value })}
        />
      </div>

      <div className="space-y-2">
        <Label>SPOC Name</Label>
        <Input
          placeholder="Point of contact name"
          value={form.spoc_name}
          onChange={(e) => onChange({ spoc_name: e.target.value })}
        />
      </div>

      <div className="space-y-2">
        <Label>Owner Name</Label>
        <Input
          placeholder="Owner / Proprietor name"
          value={form.owner_name}
          onChange={(e) => onChange({ owner_name: e.target.value })}
        />
      </div>

      <div className="space-y-2">
        <Label>Phone</Label>
        <Input
          placeholder="+91 98765 43210"
          value={form.phone}
          onChange={(e) => onChange({ phone: e.target.value })}
        />
      </div>

      <div className="space-y-2">
        <Label>Alt Phone</Label>
        <Input
          placeholder="+91 98765 43210"
          value={form.alt_phone}
          onChange={(e) => onChange({ alt_phone: e.target.value })}
        />
      </div>

      <div className="space-y-2">
        <Label>Email</Label>
        <Input
          type="email"
          placeholder="vendor@company.com"
          value={form.email}
          onChange={(e) => onChange({ email: e.target.value })}
        />
      </div>

      <div className="space-y-2 md:col-span-2">
        <Label>Address Line 1</Label>
        <Input
          placeholder="Street, building, etc."
          value={form.address_line1}
          onChange={(e) => onChange({ address_line1: e.target.value })}
        />
      </div>
      <div className="space-y-2 md:col-span-2">
        <Label>Address Line 2</Label>
        <Input
          placeholder="Apartment, suite, etc. (optional)"
          value={form.address_line2}
          onChange={(e) => onChange({ address_line2: e.target.value })}
        />
      </div>
      <div className="space-y-2">
        <Label>City</Label>
        <Input
          placeholder="City"
          value={form.city}
          onChange={(e) => onChange({ city: e.target.value })}
        />
      </div>
      <div className="space-y-2">
        <Label>State</Label>
        <Input
          placeholder="State"
          value={form.state}
          onChange={(e) => onChange({ state: e.target.value })}
        />
      </div>
      <div className="space-y-2">
        <Label>Pincode</Label>
        <Input
          placeholder="Pincode"
          value={form.pincode}
          onChange={(e) => onChange({ pincode: e.target.value })}
        />
      </div>

      <div className="space-y-2">
        <Label>Has GST?</Label>
        <Select
          value={form.has_gst}
          onValueChange={(v) => onChange({ has_gst: v })}
        >
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
        <>
          <div className="space-y-2">
            <Label>GST Number</Label>
            <Input
              placeholder="e.g. 07AAAAA0000A1Z5"
              value={form.gst_number}
              onChange={(e) => onChange({ gst_number: e.target.value.toUpperCase() })}
              onBlur={onGstBlur}
            />
            {fetchingGst && <p className="text-xs text-info">Fetching company details...</p>}
          </div>
          <div className="space-y-2 md:col-span-2">
            <Label>Auto-filled Company Name (from GST)</Label>
            <Input value={form.gst_company_name} readOnly className="bg-muted" />
          </div>
        </>
      )}

      <div className="space-y-2 md:col-span-2">
        <Label>Remarks</Label>
        <Textarea
          placeholder="Any notes about this vendor"
          value={form.remarks}
          onChange={(e) => onChange({ remarks: e.target.value })}
          rows={2}
        />
      </div>

      {showSuppliesAccessories && (
        <div className="flex items-center space-x-2 md:col-span-2">
          <Checkbox
            id="supplies_accessories"
            checked={form.supplies_accessories}
            onCheckedChange={(v) => onChange({ supplies_accessories: !!v })}
          />
          <Label htmlFor="supplies_accessories">
            Supplies accessories — visible to employees when receiving accessory stock
          </Label>
        </div>
      )}
    </div>
  )
}
