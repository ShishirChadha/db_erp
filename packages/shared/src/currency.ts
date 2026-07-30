const inr = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  maximumFractionDigits: 2,
})

export function formatCurrency(amount: number | null | undefined): string {
  return inr.format(amount ?? 0)
}
