'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Search, Download, Eye } from 'lucide-react'
import { jsPDF } from 'jspdf'
import autoTable from 'jspdf-autotable'

type Sale = {
  id: string
  sale_date: string
  sale_month: string
  sale_year: number
  invoice_number: string
  customer_name: string
  asset_number: string
  brand: string
  asset_description: string
  sale_base_price: number
  sale_gst: number
  sale_total: number
  sale_type: string
  purchases?: {
    brand: string
    asset_description: string
    base_price: number
    total_price: number
  }
}

export default function InvoicesClient({ sales }: { sales: Sale[] }) {
  const [search, setSearch] = useState('')

  const filtered = sales.filter(s =>
    s.customer_name?.toLowerCase().includes(search.toLowerCase()) ||
    s.invoice_number?.toLowerCase().includes(search.toLowerCase()) ||
    s.asset_number?.toLowerCase().includes(search.toLowerCase())
  )

  // Helper to format Indian Rupees
  const formatINR = (amount: number) => {
    return `₹${amount.toLocaleString('en-IN', { maximumFractionDigits: 2 })}`
  }

  // Generate PDF invoice
  const generatePDF = (sale: Sale) => {
    const doc = new jsPDF()

    // === Company Header ===
    doc.setFontSize(16)
    doc.setFont('helvetica', 'bold')
    doc.text('Digitalbluez Technologies Private Limited', 14, 20)

    doc.setFontSize(10)
    doc.setFont('helvetica', 'normal')
    doc.text('123, Business Park, MG Road, Bengaluru - 560001', 14, 28)
    doc.text('GSTIN: 29AAACD1234A1Z5', 14, 34)
    doc.text('Phone: +91 80 1234 5678 | Email: info@digitalbluez.com', 14, 40)

    doc.line(14, 45, 200, 45)

    // === Invoice Title ===
    doc.setFontSize(14)
    doc.setFont('helvetica', 'bold')
    doc.text('TAX INVOICE', 14, 55)

    // === Invoice Details ===
    doc.setFontSize(10)
    doc.setFont('helvetica', 'normal')
    doc.text(`Invoice No: ${sale.invoice_number || 'N/A'}`, 14, 65)
    doc.text(`Date: ${sale.sale_date}`, 14, 71)

    // === Customer Details ===
    doc.text('Bill To:', 14, 85)
    doc.setFont('helvetica', 'bold')
    doc.text(sale.customer_name || 'Customer', 14, 92)
    doc.setFont('helvetica', 'normal')
    doc.text('Address: 123 Customer Street, City, PIN', 14, 98) // you can later add address from customers table

    // === Table Header ===
    autoTable(doc, {
      startY: 110,
      head: [['#', 'Description', 'Qty', 'Unit Price', 'Taxable Value', 'GST', 'Total']],
      body: [
        [
          '1',
          `${sale.brand} ${sale.asset_description || sale.asset_number}`,
          '1',
          formatINR(sale.sale_base_price),
          formatINR(sale.sale_base_price),
          formatINR(sale.sale_gst),
          formatINR(sale.sale_total),
        ],
      ],
      theme: 'grid',
      headStyles: { fillColor: [66, 133, 244], textColor: 255, fontStyle: 'bold' },
      foot: [
        [
          '',
          '',
          '',
          '',
          '',
          'Total',
          formatINR(sale.sale_total),
        ],
      ],
    })

    const finalY = (doc as any).lastAutoTable?.finalY || 150

    // === GST Breakup ===
    doc.setFontSize(10)
    doc.text(`GST Details:`, 14, finalY + 10)
    doc.text(`CGST (9%) : ${formatINR(sale.sale_gst / 2)}`, 14, finalY + 18)
    doc.text(`SGST (9%) : ${formatINR(sale.sale_gst / 2)}`, 14, finalY + 24)

    // === Footer ===
    doc.setFontSize(8)
    doc.text('This is a computer generated invoice and does not require a physical signature.', 14, finalY + 40)

    // Save the PDF
    doc.save(`Invoice_${sale.invoice_number || sale.id}.pdf`)
  }

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-gray-900">Invoices</h1>
        <p className="text-sm text-gray-500 mt-1">Generate and download invoices for sales</p>
      </div>

      {/* Search */}
      <div className="relative mb-4">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
        <Input
          placeholder="Search by customer, invoice number, asset..."
          className="pl-9"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      {/* Sales list */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-medium">All Sales</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200 bg-gray-50">
                  <th className="text-left px-4 py-3 font-medium text-gray-600">Date</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-600">Invoice #</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-600">Customer</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-600">Asset</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-600">Total</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-600">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filtered.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="text-center py-12 text-gray-400">
                      No sales found.
                    </td>
                  </tr>
                ) : (
                  filtered.map((sale) => (
                    <tr key={sale.id} className="border-b border-gray-100 hover:bg-gray-50">
                      <td className="px-4 py-3 text-gray-600">{sale.sale_date}</td>
                      <td className="px-4 py-3 font-medium text-blue-600">{sale.invoice_number || '—'}</td>
                      <td className="px-4 py-3">{sale.customer_name}</td>
                      <td className="px-4 py-3 text-gray-600">{sale.asset_number}</td>
                      <td className="px-4 py-3 font-medium text-green-600">
                        ₹{sale.sale_total?.toLocaleString('en-IN')}
                      </td>
                      <td className="px-4 py-3">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => generatePDF(sale)}
                        >
                          <Download className="h-4 w-4 mr-1" /> Invoice
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
    </div>
  )
}