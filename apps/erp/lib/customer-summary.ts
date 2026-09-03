// A small disambiguation summary shown alongside a customer's name wherever a sale/
// asset row references one (Sales Ledger, Stock's Sold tab, Sold Accessories) --
// this customer base has a lot of repeat first names ("Amit", "Rohit", ...) with no
// other distinguishing text in the row, so this exists purely to help staff tell two
// same-named customers apart without opening the full profile. Deliberately NOT
// frozen at sale time (unlike sales.customer_name on a finalized invoice) since it's
// informational, not a legal document field -- always reflects the customer's current
// details.
export interface CustomerSummarySourceFields {
  type?: string | null;
  contact_person?: string | null;
  address_line1?: string | null;
  address_line2?: string | null;
  city?: string | null;
  source?: string | null;
}

export interface CustomerSummary {
  type: string | null;
  contact_person: string | null;
  address: string | null;
  source: string | null;
}

export function buildCustomerSummary(c: CustomerSummarySourceFields): CustomerSummary {
  return {
    type: c.type || null,
    // Contact person only applies to a Business account -- see customers.contact_person.
    contact_person: c.type === "Business" ? c.contact_person || null : null,
    address: [c.address_line1, c.address_line2, c.city].filter(Boolean).join(", ") || null,
    source: c.source || null,
  };
}
