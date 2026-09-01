// Shared by AddExpenseDialog/EditExpenseDialog: which optional fields are
// relevant to show, based on the freely-typed `expense_types` value selected.
// Both rules default to "show" for an unrecognized/new type -- an owner can add
// a new type inline at any time, and hiding a field by default for a type this
// list has never seen would silently lose data with no way to notice.

// From/To only make sense for shipping/porter-shaped expenses (the two seeded
// types this was scoped to are "Porter/Freight" and "Shipping") -- opt-in on a
// keyword match rather than an exact-string allow-list so a close variant an
// owner might type ("Freight Charges") still matches. Deliberately excludes
// "Transport" -- that's a separate, broader type (e.g. local commute/fare) that
// doesn't necessarily have a from/to in the way a shipment does.
const LOCATION_KEYWORDS = /porter|freight|shipping/i;

export function isLocationRelevantType(type: string): boolean {
  return LOCATION_KEYWORDS.test(type || "");
}

// Vendor is opt-OUT (not opt-in) for the handful of types that clearly never
// have one -- everything else, including any future custom type, shows it by
// default rather than silently hiding a field an owner might actually need.
const VENDOR_IRRELEVANT_TYPES = ["salaries", "bank charges", "gst payment"];

export function isVendorRelevantType(type: string): boolean {
  if (!type) return true;
  return !VENDOR_IRRELEVANT_TYPES.includes(type.trim().toLowerCase());
}
