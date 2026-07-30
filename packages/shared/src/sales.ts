// A unit is only offered in the Sell screen's picker (and reservable by the
// website) once it has cleared QC.
export const SELLABLE_STATUSES = ['ready_for_sale', 'qc_passed']

// Indian financial year runs April-March, so Jan-Mar belongs to the FY that
// started the previous calendar year -- not the current one.
export function financialYear(date = new Date()): string {
  const year = date.getFullYear()
  const fyStartYear = date.getMonth() >= 3 ? year : year - 1
  const nextYearShort = (fyStartYear + 1) % 100
  return `${fyStartYear}-${String(nextYearShort).padStart(2, '0')}`
}
