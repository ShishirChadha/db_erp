// GST set-off of output tax against input tax credit, in the statutory order
// (CGST Act s.49A/49B): IGST credit goes against IGST, then CGST, then SGST; CGST credit
// against CGST, then IGST; SGST credit against SGST, then IGST. CGST credit can never
// pay SGST (or the reverse). Whatever liability is left is paid from the cash ledger.
export interface Heads { igst: number; cgst: number; sgst: number }

export interface SetOffResult {
  liability: Heads
  credit: Heads
  used: { igst_on_igst: number; igst_on_cgst: number; igst_on_sgst: number; cgst_on_cgst: number; cgst_on_igst: number; sgst_on_sgst: number; sgst_on_igst: number }
  cash: Heads
  carry_forward: Heads
}

const r2 = (n: number) => Math.round(n * 100) / 100

export function setOff(liability: Heads, credit: Heads): SetOffResult {
  let Li = liability.igst, Lc = liability.cgst, Ls = liability.sgst
  let Ci = credit.igst, Cc = credit.cgst, Cs = credit.sgst
  const take = (credit: number, liab: number) => Math.min(Math.max(credit, 0), Math.max(liab, 0))

  const igst_on_igst = take(Ci, Li); Ci -= igst_on_igst; Li -= igst_on_igst
  const igst_on_cgst = take(Ci, Lc); Ci -= igst_on_cgst; Lc -= igst_on_cgst
  const igst_on_sgst = take(Ci, Ls); Ci -= igst_on_sgst; Ls -= igst_on_sgst
  const cgst_on_cgst = take(Cc, Lc); Cc -= cgst_on_cgst; Lc -= cgst_on_cgst
  const cgst_on_igst = take(Cc, Li); Cc -= cgst_on_igst; Li -= cgst_on_igst
  const sgst_on_sgst = take(Cs, Ls); Cs -= sgst_on_sgst; Ls -= sgst_on_sgst
  const sgst_on_igst = take(Cs, Li); Cs -= sgst_on_igst; Li -= sgst_on_igst

  return {
    liability: { igst: r2(liability.igst), cgst: r2(liability.cgst), sgst: r2(liability.sgst) },
    credit: { igst: r2(credit.igst), cgst: r2(credit.cgst), sgst: r2(credit.sgst) },
    used: {
      igst_on_igst: r2(igst_on_igst), igst_on_cgst: r2(igst_on_cgst), igst_on_sgst: r2(igst_on_sgst),
      cgst_on_cgst: r2(cgst_on_cgst), cgst_on_igst: r2(cgst_on_igst),
      sgst_on_sgst: r2(sgst_on_sgst), sgst_on_igst: r2(sgst_on_igst),
    },
    cash: { igst: r2(Li), cgst: r2(Lc), sgst: r2(Ls) },
    carry_forward: { igst: r2(Ci), cgst: r2(Cc), sgst: r2(Cs) },
  }
}
