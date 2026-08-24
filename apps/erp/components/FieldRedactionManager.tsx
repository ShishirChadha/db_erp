'use client'

import { useEffect, useState } from 'react'
import { apiFetch } from '@/lib/api-client'
import { Checkbox } from '@/components/ui/checkbox'

interface RedactionRule {
  id: string
  shape: string
  field_name: string
  hidden_from_employee: boolean
  hidden_from_manager: boolean
}

const SHAPE_LABELS: Record<string, string> = {
  sku_master: 'SKU Master',
  stock_list: 'Stock (Live Stock / New Entry / Invoices)',
  accessories: 'Accessories',
  vendors: 'Vendors',
}

export default function FieldRedactionManager() {
  const [rules, setRules] = useState<RedactionRule[]>([])
  const [loading, setLoading] = useState(true)
  const [savingId, setSavingId] = useState<string | null>(null)

  const fetchRules = async () => {
    setLoading(true)
    const res = await apiFetch('/api/settings/redaction-rules')
    setRules(res.ok ? await res.json() : [])
    setLoading(false)
  }

  useEffect(() => { fetchRules() }, [])

  const toggle = async (rule: RedactionRule, field: 'hidden_from_employee' | 'hidden_from_manager') => {
    setSavingId(rule.id)
    const next = { ...rule, [field]: !rule[field] }
    setRules(prev => prev.map(r => (r.id === rule.id ? next : r)))
    await apiFetch('/api/settings/redaction-rules', {
      method: 'PATCH',
      body: JSON.stringify({ id: rule.id, [field]: next[field] }),
    })
    setSavingId(null)
  }

  const grouped = rules.reduce<Record<string, RedactionRule[]>>((acc, r) => {
    acc[r.shape] = acc[r.shape] || []
    acc[r.shape].push(r)
    return acc
  }, {})

  if (loading) return <p className="text-sm text-gray-400">Loading...</p>

  return (
    <div>
      <p className="text-sm text-gray-600 mb-4">
        Choose which fields are hidden from Employee and Manager roles. The Owner always sees everything.
        Unchecking a box here reveals that field in the corresponding API responses immediately.
      </p>

      {Object.entries(grouped).map(([shape, shapeRules]) => (
        <div key={shape} className="mb-6">
          <h3 className="text-sm font-semibold mb-2">{SHAPE_LABELS[shape] || shape}</h3>
          <table className="min-w-full border">
            <thead>
              <tr>
                <th className="border p-2 text-left">Field</th>
                <th className="border p-2 text-center">Hidden from Employee</th>
                <th className="border p-2 text-center">Hidden from Manager</th>
              </tr>
            </thead>
            <tbody>
              {shapeRules.map(rule => (
                <tr key={rule.id} className={savingId === rule.id ? 'opacity-50' : ''}>
                  <td className="border p-2 font-mono text-sm">{rule.field_name}</td>
                  <td className="border p-2 text-center">
                    <Checkbox
                      checked={rule.hidden_from_employee}
                      onCheckedChange={() => toggle(rule, 'hidden_from_employee')}
                    />
                  </td>
                  <td className="border p-2 text-center">
                    <Checkbox
                      checked={rule.hidden_from_manager}
                      onCheckedChange={() => toggle(rule, 'hidden_from_manager')}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}
    </div>
  )
}
