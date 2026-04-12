export interface GSTResult {
  gstType: 'IGST' | 'CGST_SGST';
  cgstAmount: number;
  sgstAmount: number;
  igstAmount: number;
  totalGst: number;
}

/**
 * Calculate GST based on place of supply and customer GST status
 * @param amount - The taxable amount
 * @param gstRate - GST rate in percentage (e.g., 18 for 18%)
 * @param placeOfSupply - State where goods/services are supplied
 * @param customerGst - Customer's GST number (null if not registered)
 * @param businessState - Your business state (default: 'Delhi')
 * @returns GSTResult with split details
 */
export function calculateGST(
  amount: number,
  gstRate: number,
  placeOfSupply: string = '',
  customerGst: string | null = null,
  businessState: string = 'Delhi'
): GSTResult {
  const totalGst = (amount * gstRate) / 100;
  const halfGst = totalGst / 2;

  // If place of supply is same as business state AND customer has GST number -> Intra-state (CGST+SGST)
  const isIntraState = placeOfSupply === businessState && customerGst && customerGst.trim() !== '';

  if (isIntraState) {
    return {
      gstType: 'CGST_SGST',
      cgstAmount: halfGst,
      sgstAmount: halfGst,
      igstAmount: 0,
      totalGst: totalGst,
    };
  } else {
    return {
      gstType: 'IGST',
      cgstAmount: 0,
      sgstAmount: 0,
      igstAmount: totalGst,
      totalGst: totalGst,
    };
  }
}

/**
 * Format GST for display
 */
export function formatGSTBreakdown(gstResult: GSTResult): string {
  if (gstResult.gstType === 'IGST') {
    return `IGST: ₹${gstResult.igstAmount.toFixed(2)}`;
  } else {
    return `CGST: ₹${gstResult.cgstAmount.toFixed(2)} | SGST: ₹${gstResult.sgstAmount.toFixed(2)}`;
  }
}