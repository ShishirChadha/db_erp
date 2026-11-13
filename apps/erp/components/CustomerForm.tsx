"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ArrowDown, ChevronRight, FileDown, Info, Loader2, Mail, PlusCircle, Trash2 } from "lucide-react";
import { apiFetch } from "@/lib/api-client";
import { useAsyncAction } from "@/lib/useAsyncAction";
import { checkDuplicateCustomer } from "@/lib/customer-dedupe";
import { gstValidationError } from "@/lib/gst-validation";
import { stateCodeFromPincode, stateNameFromPincode } from "@/lib/pincode-state";
import { STATE_CODE_TO_NAME, stateNameFromCode } from "@/lib/gstStateCodes";
import { cn } from "@/lib/utils";

// One customer form (Zoho Books layout) behind both AddCustomerDialog and
// EditCustomerDialog. Billing address = the long-standing address_line1/2,
// city, state, state_code, pincode columns (what GST place of supply reads);
// shipping lives in shipping_* and is snapshotted onto invoices/quotations.
// Layout reacts to the container (the dialog), not the viewport, so the same
// form reads Zoho-wide on the Customers page and stacks inside a phone-width
// dialog on the Sell screens.

// Dialog shell sizes, matching Zoho: the Customers page opens it near full-page
// (Zoho's own full-width New Customer page), sell-side flows open Zoho's ~850px modal.
// Either way the header and the Save/Cancel footer stay fixed while the body
// scrolls; on phones it fills the screen. `sm:` widths are explicit because the
// shared DialogContent defaults to sm:max-w-sm, which beats a plain max-w-*.
export type CustomerDialogSize = "page" | "modal";
export function customerDialogClass(size: CustomerDialogSize = "modal") {
  return cn(
    "flex flex-col gap-0 overflow-hidden p-0 max-w-[calc(100%-1rem)] h-[calc(100dvh-1rem)]",
    size === "page"
      ? "sm:max-w-[calc(100%-2rem)] sm:h-[calc(100dvh-2rem)]"
      : "sm:max-w-[850px] sm:h-[calc(100dvh-2rem)]",
  );
}
export const customerDialogHeaderClass = "border-b px-6 py-4 text-left";
export const customerDialogTitleClass = "text-2xl font-normal";

export const SALUTATIONS = ["Mr.", "Mrs.", "Ms.", "Miss", "Dr."];

export const GST_TREATMENTS: { value: string; label: string; hint: string }[] = [
  { value: "registered_regular", label: "Registered Business - Regular", hint: "Business registered under GST" },
  { value: "registered_composition", label: "Registered Business - Composition", hint: "Business under the Composition Scheme" },
  { value: "unregistered_business", label: "Unregistered Business", hint: "Business not registered under GST" },
  { value: "consumer", label: "Consumer", hint: "A customer who is a regular consumer" },
  { value: "overseas", label: "Overseas", hint: "Supply to a customer outside India" },
];

const REGISTERED = ["registered_regular", "registered_composition"];
const CHANNELS = [
  { value: "email", label: "Email" },
  { value: "sms", label: "SMS" },
  { value: "whatsapp", label: "WhatsApp" },
];
// Retired codes stay renderable on old records but aren't offered for new ones.
const RETIRED_STATE_CODES = ["25", "28", "99"];

type TabKey = "other" | "address" | "contacts" | "remarks";
const TABS: { value: TabKey; label: string }[] = [
  { value: "other", label: "Other Details" },
  { value: "address", label: "Address" },
  { value: "contacts", label: "Contact Persons" },
  { value: "remarks", label: "Remarks" },
];

export interface ContactPerson {
  salutation: string;
  first_name: string;
  last_name: string;
  email: string;
  work_phone: string;
  mobile: string;
}

const emptyContact: ContactPerson = { salutation: "", first_name: "", last_name: "", email: "", work_phone: "", mobile: "" };

export interface CustomerFormValues {
  type: string;
  salutation: string;
  first_name: string;
  last_name: string;
  company_name: string;
  customer_name: string;
  email: string;
  work_phone: string;
  phone: string;
  communication_channels: string[];
  gst_treatment: string;
  gst_number: string;
  state: string;
  state_code: string;
  pan: string;
  source: string;
  google_review: boolean;
  social_following: string;
  alt_email: string;
  billing_attention: string;
  address_line1: string;
  address_line2: string;
  city: string;
  pincode: string;
  shipping_attention: string;
  shipping_address_line1: string;
  shipping_address_line2: string;
  shipping_city: string;
  shipping_state: string;
  shipping_pincode: string;
  billing_phone: string;
  shipping_phone: string;
  contact_persons: ContactPerson[];
  remarks: string;
}

const emptyValues: CustomerFormValues = {
  type: "Business",
  salutation: "",
  first_name: "",
  last_name: "",
  company_name: "",
  customer_name: "",
  email: "",
  work_phone: "",
  phone: "",
  communication_channels: ["email"],
  gst_treatment: "",
  gst_number: "",
  state: "",
  state_code: "",
  pan: "",
  source: "",
  google_review: false,
  social_following: "None",
  alt_email: "",
  billing_attention: "",
  address_line1: "",
  address_line2: "",
  city: "",
  pincode: "",
  shipping_attention: "",
  shipping_address_line1: "",
  shipping_address_line2: "",
  shipping_city: "",
  shipping_state: "",
  shipping_pincode: "",
  billing_phone: "",
  shipping_phone: "",
  contact_persons: [],
  remarks: "",
};

// Builds form values from a stored customer row. A customer created before the
// structured address fields existed has only the flat `address` -- shown in
// Street 1 so the next save doesn't silently discard it.
function valuesFromCustomer(c: any): CustomerFormValues {
  const s = (v: any) => (v == null ? "" : String(v));
  const legacyAddressOnly = !c.address_line1 && !c.address_line2 && !c.city && !c.pincode && c.address;
  const gstNumber = s(c.gst_number);
  let stateCode = s(c.state_code);
  let state = s(c.state);
  if (!stateCode && !gstNumber.trim()) {
    const pin = stateCodeFromPincode(c.pincode);
    if (pin) { stateCode = pin; state = stateNameFromPincode(c.pincode) || ""; }
  }
  return {
    ...emptyValues,
    type: c.type === "Business" ? "Business" : "Individual",
    salutation: s(c.salutation),
    first_name: s(c.first_name),
    last_name: s(c.last_name),
    company_name: s(c.company_name),
    customer_name: s(c.customer_name),
    email: s(c.email),
    work_phone: s(c.work_phone),
    phone: s(c.phone),
    communication_channels: Array.isArray(c.communication_channels) ? c.communication_channels : ["email"],
    gst_treatment: s(c.gst_treatment) || (gstNumber.trim() ? "registered_regular" : c.type === "Business" ? "" : "consumer"),
    gst_number: gstNumber,
    state,
    state_code: stateCode,
    pan: s(c.pan),
    source: s(c.source),
    google_review: !!c.google_review,
    social_following: s(c.social_following) || "None",
    alt_email: s(c.alt_email),
    billing_attention: s(c.billing_attention),
    address_line1: legacyAddressOnly ? s(c.address) : s(c.address_line1),
    address_line2: s(c.address_line2),
    city: s(c.city),
    pincode: s(c.pincode),
    shipping_attention: s(c.shipping_attention),
    shipping_address_line1: s(c.shipping_address_line1),
    shipping_address_line2: s(c.shipping_address_line2),
    shipping_city: s(c.shipping_city),
    shipping_state: s(c.shipping_state),
    shipping_pincode: s(c.shipping_pincode),
    billing_phone: s(c.billing_phone),
    shipping_phone: s(c.shipping_phone),
    contact_persons: Array.isArray(c.contact_persons)
      ? c.contact_persons.map((p: any) => ({ ...emptyContact, ...p }))
      : c.contact_person ? [{ ...emptyContact, first_name: s(c.contact_person) }] : [],
    remarks: s(c.remarks),
  };
}

// Composes the flat address columns from their parts -- kept in sync on every
// save because `address` (billing) and `shipping_address` are what invoices,
// quotations and their PDFs snapshot.
function composeAddress(line1: string, line2: string, city: string, state: string, pincode: string): string {
  return [line1, line2, city, [state, pincode].filter(Boolean).join(" - ")]
    .map((p) => p.trim())
    .filter(Boolean)
    .join(", ");
}

// Accepts "+91 98765 43210", "09876543210", "919876543210" and stores the bare
// 10 digits, so the duplicate-phone check compares like with like.
export function normalizeMobile(raw: string): string {
  const digits = raw.replace(/\D/g, "");
  if (digits.length === 12 && digits.startsWith("91")) return digits.slice(2);
  if (digits.length === 11 && digits.startsWith("0")) return digits.slice(1);
  return digits;
}

const PAN_RE = /^[A-Z]{5}[0-9]{4}[A-Z]$/;
const PIN_RE = /^\d{6}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const FIELD_TAB: Record<string, TabKey | null> = {
  customer_name: null, phone: null, email: null, company_name: null,
  gst_treatment: "other", gst_number: "other", state_code: "other", pan: "other", alt_email: "other",
  address_line1: "address", city: "address", pincode: "address", shipping_pincode: "address",
  contact_persons: "contacts",
};

// Explicit allow-list (never a spread of the form/customer object): the
// Customers page passes rows joined with `customer_profiles(...)`, and any
// unknown key makes PostgREST reject the whole write (PGRST204).
function toPayload(v: CustomerFormValues) {
  const isBusiness = v.type === "Business";
  const registered = REGISTERED.includes(v.gst_treatment);
  const contacts = v.contact_persons
    .map((p) => ({ ...p, mobile: p.mobile ? normalizeMobile(p.mobile) : "" }))
    .filter((p) => p.first_name.trim() || p.last_name.trim() || p.email.trim() || p.mobile.trim() || p.work_phone.trim());
  const primaryContactName = [v.salutation, v.first_name, v.last_name].map((x) => x.trim()).filter(Boolean).join(" ");
  const firstContactName = contacts[0] ? [contacts[0].first_name, contacts[0].last_name].map((x) => x.trim()).filter(Boolean).join(" ") : "";
  const shippingAddress = composeAddress(v.shipping_address_line1, v.shipping_address_line2, v.shipping_city, v.shipping_state, v.shipping_pincode);
  return {
    type: v.type,
    salutation: v.salutation || null,
    first_name: v.first_name.trim() || null,
    last_name: v.last_name.trim() || null,
    company_name: isBusiness ? v.company_name.trim() || null : null,
    customer_name: v.customer_name.trim(),
    email: v.email.trim(),
    work_phone: v.work_phone.trim() || null,
    phone: normalizeMobile(v.phone),
    communication_channels: v.communication_channels,
    gst_treatment: v.gst_treatment,
    has_gst: registered,
    gst_number: registered ? v.gst_number.trim().toUpperCase() : "",
    state: v.state,
    state_code: v.state_code,
    pan: v.pan.trim().toUpperCase() || null,
    source: v.source,
    google_review: v.google_review,
    social_following: v.social_following,
    alt_email: v.alt_email.trim(),
    billing_attention: v.billing_attention.trim() || null,
    address_line1: v.address_line1.trim(),
    address_line2: v.address_line2.trim(),
    city: v.city.trim(),
    pincode: v.pincode.trim(),
    address: composeAddress(v.address_line1, v.address_line2, v.city, v.state, v.pincode),
    shipping_attention: v.shipping_attention.trim() || null,
    shipping_address_line1: v.shipping_address_line1.trim() || null,
    shipping_address_line2: v.shipping_address_line2.trim() || null,
    shipping_city: v.shipping_city.trim() || null,
    shipping_state: v.shipping_state || null,
    shipping_pincode: v.shipping_pincode.trim() || null,
    billing_phone: v.billing_phone.trim() || null,
    shipping_phone: v.shipping_phone.trim() || null,
    shipping_address: shippingAddress || null,
    contact_persons: contacts,
    // Legacy single-name column still read by Sales/Stock listings.
    contact_person: firstContactName || (isBusiness ? primaryContactName : "") || null,
    remarks: v.remarks.trim() || null,
  };
}

// Zoho geometry: a 180px label column and fixed-width fields (330px standard,
// 138/150/150 for the name, 210px per phone) once the container is wide enough;
// below that, labels stack above full-width fields.
const FIELD_W = "@2xl:w-[330px]";

function Row({ label, required, hint, children, className }: { label: string; required?: boolean; hint?: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={cn("grid gap-1.5 @2xl:grid-cols-[180px_1fr] @2xl:items-start @2xl:gap-x-0", className)}>
      <Label className={cn("flex items-center gap-1 text-sm font-normal @2xl:min-h-8 @2xl:pr-3", required && "text-destructive")}>
        {label}{required && "*"}
        {hint && <span title={hint} className="text-muted-foreground"><Info className="h-3.5 w-3.5" /></span>}
      </Label>
      <div className="min-w-0">{children}</div>
    </div>
  );
}

function FieldError({ msg }: { msg?: string }) {
  return msg ? <p className="text-xs text-destructive mt-1">{msg}</p> : null;
}

function PhoneInput({ value, onChange, placeholder, className }: { value: string; onChange: (v: string) => void; placeholder: string; className?: string }) {
  return (
    <div className={cn("flex", className)}>
      <span className="inline-flex h-8 shrink-0 items-center rounded-l-md border border-r-0 border-input bg-muted px-2.5 text-sm text-muted-foreground">+91</span>
      <Input className="min-w-0 rounded-l-none" inputMode="tel" placeholder={placeholder} value={value} onChange={(e) => onChange(e.target.value)} />
    </div>
  );
}

// Zoho's address columns: label-left rows inside each of Billing / Shipping.
// Must live at module level -- declared inside CustomerForm it would be a new
// component type on every render, remounting its input on each keystroke.
function AddrRow({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <div className="grid gap-1.5 @md:grid-cols-[120px_1fr] @md:items-start">
      <Label className={cn("text-sm font-normal @md:min-h-8 @md:flex @md:items-center", required && "text-destructive")}>{label}{required && "*"}</Label>
      <div className="min-w-0">{children}</div>
    </div>
  );
}

function StateSelect({ value, onChange, placeholder }: { value: string; onChange: (code: string) => void; placeholder: string }) {
  const codes = Object.keys(STATE_CODE_TO_NAME).filter((c) => !RETIRED_STATE_CODES.includes(c) || c === value);
  return (
    <Select value={value || undefined} onValueChange={onChange}>
      <SelectTrigger className="w-full"><SelectValue placeholder={placeholder} /></SelectTrigger>
      <SelectContent>
        {codes.map((c) => <SelectItem key={c} value={c}>[{c}] {STATE_CODE_TO_NAME[c]}</SelectItem>)}
      </SelectContent>
    </Select>
  );
}

export default function CustomerForm({
  customer,
  submitLabel,
  onSaved,
  onCancel,
}: {
  /** Existing row to edit; omit to create a new customer. */
  customer?: any;
  submitLabel: string;
  onSaved: (row: any) => void;
  onCancel: () => void;
}) {
  const supabase = createClient();
  const [v, setV] = useState<CustomerFormValues>(() => (customer ? valuesFromCustomer(customer) : emptyValues));
  const [tab, setTab] = useState<TabKey>("other");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [duplicateWarning, setDuplicateWarning] = useState("");
  const [gstFetching, setGstFetching] = useState(false);
  const [gstNote, setGstNote] = useState("");

  useEffect(() => {
    setV(customer ? valuesFromCustomer(customer) : emptyValues);
    setErrors({});
    setDuplicateWarning("");
    setGstNote("");
    setTab("other");
  }, [customer]);

  const isBusiness = v.type === "Business";
  const registered = REGISTERED.includes(v.gst_treatment);

  const set = <K extends keyof CustomerFormValues>(field: K, value: CustomerFormValues[K]) => {
    setV((prev) => ({ ...prev, [field]: value }));
    if (errors[field as string]) setErrors((e) => ({ ...e, [field as string]: "" }));
  };

  const setType = (type: string) => {
    // Company and GSTIN don't apply to an Individual -- clear them so a stale
    // value can't get silently submitted while hidden. Contact persons stay
    // (Zoho keeps them for both types).
    setV((prev) => type === "Individual"
      ? { ...prev, type, company_name: "", gst_number: "", gst_treatment: "consumer" }
      : { ...prev, type, gst_treatment: prev.gst_treatment === "consumer" ? "" : prev.gst_treatment });
  };

  const setGstTreatment = (t: string) => {
    setV((prev) => REGISTERED.includes(t) ? { ...prev, gst_treatment: t }
      : { ...prev, gst_treatment: t, gst_number: "", ...(t === "overseas" ? { state_code: "97", state: STATE_CODE_TO_NAME["97"] } : {}) });
    setErrors((e) => ({ ...e, gst_treatment: "", gst_number: "" }));
  };

  // A GSTIN fixes the state (its first two digits) and the PAN (chars 3-12).
  const setGstNumber = (raw: string) => {
    const gst = raw.toUpperCase().replace(/\s/g, "");
    setV((prev) => {
      const next = { ...prev, gst_number: gst };
      if (gst.length >= 2 && STATE_CODE_TO_NAME[gst.slice(0, 2)]) {
        next.state_code = gst.slice(0, 2);
        next.state = STATE_CODE_TO_NAME[next.state_code];
      }
      if (gst.length >= 12 && PAN_RE.test(gst.slice(2, 12))) next.pan = gst.slice(2, 12);
      return next;
    });
    setErrors((e) => ({ ...e, gst_number: "" }));
  };

  // PIN -> City/State via /api/pincode (India Post). City is only filled when
  // it's blank or still holds the previous auto-filled value, so a city typed
  // by hand is never overwritten.
  type AddrKind = "billing" | "shipping";
  const autoCity = useRef<Record<AddrKind, string>>({ billing: "", shipping: "" });
  const [pinInfo, setPinInfo] = useState<Record<AddrKind, { loading?: boolean; note?: string; options?: string[] }>>({ billing: {}, shipping: {} });
  const lookupPin = async (kind: AddrKind, pin: string) => {
    setPinInfo((p) => ({ ...p, [kind]: { loading: true } }));
    try {
      const res = await apiFetch(`/api/pincode?pin=${pin}`);
      const data = await res.json();
      if (!res.ok) {
        setPinInfo((p) => ({ ...p, [kind]: { note: data.error || "Couldn't look up this PIN; type the city." } }));
        return;
      }
      const cityKey = kind === "billing" ? "city" : "shipping_city";
      const pinKey = kind === "billing" ? "pincode" : "shipping_pincode";
      setV((prev) => {
        if (prev[pinKey].trim() !== pin) return prev; // PIN changed while the lookup ran
        const next = { ...prev };
        const current = prev[cityKey].trim();
        if (data.city && (!current || current === autoCity.current[kind])) {
          next[cityKey] = data.city;
          autoCity.current[kind] = data.city;
        }
        if (data.state_code && STATE_CODE_TO_NAME[data.state_code]) {
          // A GSTIN (or Overseas) fixes the billing state; otherwise India Post's
          // state is more reliable than the PIN-range guess.
          if (kind === "billing" && !prev.gst_number.trim() && prev.gst_treatment !== "overseas") {
            next.state_code = data.state_code;
            next.state = STATE_CODE_TO_NAME[data.state_code];
          }
          if (kind === "shipping") next.shipping_state = STATE_CODE_TO_NAME[data.state_code];
        }
        return next;
      });
      setErrors((e) => ({ ...e, [cityKey]: "" }));
      setPinInfo((p) => ({ ...p, [kind]: { options: Array.from(new Set([data.city, data.district].filter(Boolean))) } }));
    } catch {
      setPinInfo((p) => ({ ...p, [kind]: { note: "Couldn't look up this PIN; type the city." } }));
    }
  };

  // Without a GSTIN the place of supply comes from the billing PIN -- it decides
  // CGST+SGST vs IGST. Ambiguous PIN ranges resolve to null and leave it blank.
  const setPincode = (pincode: string) => {
    setV((prev) => {
      if (prev.gst_number.trim() || prev.gst_treatment === "overseas") return { ...prev, pincode };
      const code = stateCodeFromPincode(pincode);
      return code ? { ...prev, pincode, state_code: code, state: stateNameFromPincode(pincode) || STATE_CODE_TO_NAME[code] || "" } : { ...prev, pincode };
    });
    setErrors((e) => ({ ...e, pincode: "", state_code: "" }));
    if (PIN_RE.test(pincode.trim())) lookupPin("billing", pincode.trim());
    else setPinInfo((p) => ({ ...p, billing: {} }));
  };

  const setPlaceOfSupply = (code: string) => {
    setV((prev) => ({ ...prev, state_code: code, state: stateNameFromCode(code) || "" }));
    setErrors((e) => ({ ...e, state_code: "" }));
  };

  const setShippingPincode = (pincode: string) => {
    setV((prev) => ({ ...prev, shipping_pincode: pincode, shipping_state: stateNameFromPincode(pincode) || prev.shipping_state }));
    setErrors((e) => ({ ...e, shipping_pincode: "" }));
    if (PIN_RE.test(pincode.trim())) lookupPin("shipping", pincode.trim());
    else setPinInfo((p) => ({ ...p, shipping: {} }));
  };

  const copyBilling = () => {
    setV((prev) => ({
      ...prev,
      shipping_attention: prev.billing_attention,
      shipping_address_line1: prev.address_line1,
      shipping_address_line2: prev.address_line2,
      shipping_city: prev.city,
      shipping_state: prev.state,
      shipping_pincode: prev.pincode,
      shipping_phone: prev.billing_phone || prev.shipping_phone || prev.phone,
    }));
  };

  // Zoho's Display Name dropdown: offers the usual ways of naming this customer,
  // still free-text.
  const displayNameOptions = useMemo(() => {
    const first = v.first_name.trim();
    const last = v.last_name.trim();
    const full = [first, last].filter(Boolean).join(" ");
    const opts = [
      v.company_name.trim(),
      full,
      [v.salutation, full].filter(Boolean).join(" "),
      [last, first].filter(Boolean).join(", "),
    ].filter((o) => o && o !== v.salutation);
    return Array.from(new Set(opts));
  }, [v.first_name, v.last_name, v.salutation, v.company_name]);

  const handleFetchGst = async (gstin: string = v.gst_number) => {
    if (!gstin.trim()) return;
    setGstFetching(true);
    setGstNote("");
    try {
      const res = await apiFetch(`/api/gst?gst=${encodeURIComponent(gstin.trim())}`);
      const data = await res.json();
      // The lookup returns one flat address string -- dropped into Street 1 as a
      // starting point, still editable/splittable by hand.
      setV((prev) => ({
        ...prev,
        company_name: data.company_name || prev.company_name,
        customer_name: prev.customer_name || data.company_name || "",
        address_line1: data.address || prev.address_line1,
        state: data.state || prev.state,
        state_code: data.state_code || prev.state_code,
      }));
      setGstNote(res.ok ? "Details filled from the GST portal." : data.error || "Could not verify this GSTIN, but state was derived from it.");
    } catch {
      setGstNote("Failed to reach GST lookup service.");
    } finally {
      setGstFetching(false);
    }
  };

  // Zoho's top banner: enter a GSTIN once and it becomes a Registered Business
  // with GSTIN, state, PAN, company and billing Street 1 filled in.
  const [prefillOpen, setPrefillOpen] = useState(false);
  const [prefillGstin, setPrefillGstin] = useState("");
  const runPrefill = async () => {
    const gst = prefillGstin.toUpperCase().replace(/\s/g, "");
    if (!gst) return;
    setV((prev) => ({ ...prev, type: "Business", gst_treatment: prev.gst_treatment === "registered_composition" ? prev.gst_treatment : "registered_regular" }));
    setGstNumber(gst);
    setTab("other");
    await handleFetchGst(gst);
    setPrefillOpen(false);
  };

  const validate = (): Record<string, string> => {
    const e: Record<string, string> = {};
    if (!v.customer_name.trim()) e.customer_name = "Display Name is required.";
    const mobile = normalizeMobile(v.phone);
    if (!mobile) e.phone = "Mobile number is required.";
    else if (!/^[6-9]\d{9}$/.test(mobile)) e.phone = "Enter a valid 10-digit mobile number.";
    if (v.email.trim() && !EMAIL_RE.test(v.email.trim())) e.email = "Enter a valid email address.";
    if (v.alt_email.trim() && !EMAIL_RE.test(v.alt_email.trim())) e.alt_email = "Enter a valid email address.";
    if (!v.gst_treatment) e.gst_treatment = "Select a GST treatment.";
    if (registered) {
      const gstErr = v.gst_number.trim() ? gstValidationError(v.gst_number, v.state_code) : "GSTIN is required for a registered business.";
      if (gstErr) e.gst_number = gstErr;
    }
    if (!v.state_code) e.state_code = "Place of Supply is required.";
    if (v.pan.trim() && !PAN_RE.test(v.pan.trim().toUpperCase())) e.pan = "PAN must look like ABCDE1234F.";
    if (!v.address_line1.trim()) e.address_line1 = "Billing street address is required.";
    if (!v.city.trim()) e.city = "Billing city is required.";
    if (v.gst_treatment !== "overseas" && !PIN_RE.test(v.pincode.trim())) e.pincode = "6-digit PIN code is required.";
    if (v.shipping_pincode.trim() && !PIN_RE.test(v.shipping_pincode.trim())) e.shipping_pincode = "PIN code must be 6 digits.";
    return e;
  };

  const { run: handleSubmit, pending: saving } = useAsyncAction(async (ev: React.FormEvent) => {
    ev.preventDefault();
    setDuplicateWarning("");
    const e = validate();
    setErrors(e);
    const firstBad = Object.keys(e).find((k) => e[k]);
    if (firstBad) {
      const t = FIELD_TAB[firstBad];
      if (t) setTab(t);
      return;
    }

    const payload = toPayload(v);
    const { blockingMatch, nameWarningMatch } = await checkDuplicateCustomer(supabase, {
      customer_name: payload.customer_name,
      phone: payload.phone,
      excludeId: customer?.id,
    });
    if (blockingMatch) {
      setErrors({ phone: `A customer with this mobile number already exists: "${blockingMatch.customer_name}". Use that customer instead of creating a duplicate.` });
      return;
    }
    if (nameWarningMatch) {
      setDuplicateWarning(`Note: a customer named "${nameWarningMatch.customer_name}" already exists with a different mobile number.`);
    }

    const query = customer?.id
      ? supabase.from("customers").update(payload).eq("id", customer.id).select().single()
      : supabase.from("customers").insert([payload]).select().single();
    const { data, error } = await query;
    if (error) {
      console.error(error);
      // 23505 = unique_violation -- customers_active_phone_unique catching a race
      // the pre-check above missed (two staff saving the same phone at once).
      if ((error as any).code === "23505") setErrors({ phone: "A customer with this mobile number already exists." });
      else alert(error.message || "Failed to save customer.");
      return;
    }
    onSaved(data);
  });

  const tabHasError = (t: TabKey) => Object.entries(errors).some(([k, msg]) => msg && FIELD_TAB[k] === t);

  const addressBlock = (kind: "billing" | "shipping") => {
    const b = kind === "billing";
    const k = (billing: keyof CustomerFormValues, shipping: keyof CustomerFormValues) => (b ? billing : shipping);
    const text = (billing: keyof CustomerFormValues, shipping: keyof CustomerFormValues) => ({
      value: v[k(billing, shipping)] as string,
      onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => set(k(billing, shipping), e.target.value as any),
    });
    const pinRequired = b && v.gst_treatment !== "overseas";
    return (
      <div className="space-y-3">
        <AddrRow label="Attention"><Input {...text("billing_attention", "shipping_attention")} /></AddrRow>
        <AddrRow label="Address" required={b}>
          <div className="space-y-2">
            <Textarea rows={2} className="min-h-14" placeholder="Street 1" {...text("address_line1", "shipping_address_line1")} />
            {b && <FieldError msg={errors.address_line1} />}
            <Textarea rows={2} className="min-h-14" placeholder="Street 2" {...text("address_line2", "shipping_address_line2")} />
          </div>
        </AddrRow>
        <AddrRow label="City" required={b}>
          <Input placeholder="Filled from the PIN code" list={`city-options-${kind}`} {...text("city", "shipping_city")} />
          <datalist id={`city-options-${kind}`}>
            {(pinInfo[kind].options || []).map((o) => <option key={o} value={o} />)}
          </datalist>
          {b && <FieldError msg={errors.city} />}
        </AddrRow>
        <AddrRow label="State">
          {b ? (
            <StateSelect value={v.state_code} onChange={setPlaceOfSupply} placeholder="Select or type to add" />
          ) : (
            <StateSelect
              value={Object.keys(STATE_CODE_TO_NAME).find((c) => STATE_CODE_TO_NAME[c] === v.shipping_state) || ""}
              onChange={(code) => set("shipping_state", STATE_CODE_TO_NAME[code] || "")}
              placeholder="Select or type to add"
            />
          )}
        </AddrRow>
        <AddrRow label="Pin Code" required={pinRequired}>
          <Input inputMode="numeric" maxLength={6} value={b ? v.pincode : v.shipping_pincode} onChange={(e) => (b ? setPincode(e.target.value) : setShippingPincode(e.target.value))} />
          <FieldError msg={b ? errors.pincode : errors.shipping_pincode} />
          {pinInfo[kind].loading && (
            <p className="mt-1 flex items-center gap-1 text-xs text-muted-foreground"><Loader2 className="h-3 w-3 animate-spin" /> Looking up city…</p>
          )}
          {pinInfo[kind].note && <p className="mt-1 text-xs text-muted-foreground">{pinInfo[kind].note}</p>}
        </AddrRow>
        <AddrRow label="Phone">
          <PhoneInput value={b ? v.billing_phone : v.shipping_phone} onChange={(val) => set(b ? "billing_phone" : "shipping_phone", val)} placeholder="" />
        </AddrRow>
      </div>
    );
  };

  const updateContact = (i: number, field: keyof ContactPerson, val: string) =>
    set("contact_persons", v.contact_persons.map((cp, j) => (j === i ? { ...cp, [field]: val } : cp)));

  return (
    <form onSubmit={handleSubmit} className="@container flex min-h-0 flex-1 flex-col" noValidate>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {/* Zoho's GST portal prefill strip */}
        <div className="border-b bg-primary/5 px-6 py-2.5 text-sm">
          {!prefillOpen ? (
            <div className="flex flex-wrap items-center gap-2">
              <FileDown className="h-4 w-4 shrink-0 text-primary" />
              <span>Prefill Customer details from the GST portal using the Customer&apos;s GSTIN.</span>
              <button type="button" className="inline-flex items-center font-medium text-primary hover:underline" onClick={() => setPrefillOpen(true)}>
                Prefill <ChevronRight className="h-4 w-4" />
              </button>
            </div>
          ) : (
            <div className="flex flex-wrap items-center gap-2">
              <span className="shrink-0">GSTIN</span>
              <Input
                autoFocus
                className="w-[220px] bg-background"
                maxLength={15}
                placeholder="e.g. 09AAICD2790D1ZM"
                value={prefillGstin}
                onChange={(e) => setPrefillGstin(e.target.value.toUpperCase())}
                onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); runPrefill(); } }}
              />
              <Button type="button" size="sm" disabled={gstFetching || !prefillGstin.trim()} onClick={runPrefill}>
                {gstFetching ? <Loader2 className="h-4 w-4 animate-spin" /> : "Prefill"}
              </Button>
              <Button type="button" size="sm" variant="ghost" onClick={() => setPrefillOpen(false)}>Cancel</Button>
            </div>
          )}
          {gstNote && !prefillOpen && <p className="mt-1 text-xs text-muted-foreground">{gstNote}</p>}
        </div>

        <div className="space-y-6 px-6 py-5">
          <div className="space-y-3">
            <Row label="Customer Type" hint="Business customers have a company; Individuals are walk-in consumers.">
              <div className="flex h-8 items-center gap-5">
                {["Business", "Individual"].map((t) => (
                  <label key={t} className="flex cursor-pointer items-center gap-2 text-sm">
                    <input type="radio" name="customer_type" className="h-4 w-4 accent-primary" checked={v.type === t} onChange={() => setType(t)} />
                    {t}
                  </label>
                ))}
              </div>
            </Row>
            <Row label="Primary Contact" hint="The person you deal with at this customer.">
              <div className="grid grid-cols-1 gap-2 @md:grid-cols-[138px_1fr_1fr] @2xl:grid-cols-[138px_150px_150px]">
                <Select value={v.salutation || undefined} onValueChange={(val) => set("salutation", val)}>
                  <SelectTrigger className="w-full"><SelectValue placeholder="Salutation" /></SelectTrigger>
                  <SelectContent>{SALUTATIONS.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
                </Select>
                <Input placeholder="First Name" value={v.first_name} onChange={(e) => set("first_name", e.target.value)} />
                <Input placeholder="Last Name" value={v.last_name} onChange={(e) => set("last_name", e.target.value)} />
              </div>
            </Row>
            {isBusiness && (
              <Row label="Company Name">
                <Input className={FIELD_W} value={v.company_name} onChange={(e) => set("company_name", e.target.value)} />
              </Row>
            )}
            <Row label="Display Name" required hint="The name shown on invoices, quotations and everywhere this customer is picked.">
              <Input
                className={FIELD_W}
                list="customer-display-name-options"
                placeholder="Select or type to add"
                value={v.customer_name}
                onChange={(e) => set("customer_name", e.target.value)}
              />
              <datalist id="customer-display-name-options">
                {displayNameOptions.map((o) => <option key={o} value={o} />)}
              </datalist>
              <FieldError msg={errors.customer_name} />
            </Row>
            <Row label="Email Address" hint="Invoices and quotations are emailed here.">
              <div className={cn("relative", FIELD_W)}>
                <Mail className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input className="pl-8" type="email" value={v.email} onChange={(e) => set("email", e.target.value)} />
              </div>
              <FieldError msg={errors.email} />
            </Row>
            <Row label="Phone" required hint="Mobile is required and must be unique per customer.">
              <div className="grid grid-cols-1 gap-2 @md:grid-cols-2 @2xl:grid-cols-[210px_210px] @2xl:gap-x-[30px]">
                <PhoneInput value={v.work_phone} onChange={(val) => set("work_phone", val)} placeholder="Work Phone" />
                <PhoneInput value={v.phone} onChange={(val) => set("phone", val)} placeholder="Mobile*" />
              </div>
              <FieldError msg={errors.phone} />
            </Row>
            <Row label="Communication Channels">
              <div className="flex min-h-8 flex-wrap items-center gap-x-8 gap-y-2">
                {CHANNELS.map((ch) => (
                  <label key={ch.value} className="flex cursor-pointer items-center gap-2 text-sm">
                    <Checkbox
                      checked={v.communication_channels.includes(ch.value)}
                      onCheckedChange={(checked) => set("communication_channels", checked
                        ? [...v.communication_channels, ch.value]
                        : v.communication_channels.filter((c) => c !== ch.value))}
                    />
                    {ch.label}
                  </label>
                ))}
              </div>
            </Row>
          </div>

          <Tabs value={tab} onValueChange={(t) => setTab(t as TabKey)} className="gap-0">
            {/* Narrow containers swap the strip for a dropdown so nothing scrolls sideways. */}
            <div className="@xl:hidden">
              <Select value={tab} onValueChange={(t) => setTab(t as TabKey)}>
                <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {TABS.map((t) => (
                    <SelectItem key={t.value} value={t.value}>{t.label}{tabHasError(t.value) ? " •" : ""}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <TabsList variant="line" className="hidden h-auto w-full max-w-[1050px] justify-start gap-6 rounded-none border-b p-0 @xl:flex">
              {TABS.map((t) => (
                <TabsTrigger
                  key={t.value}
                  value={t.value}
                  className={cn(
                    "flex-none rounded-none px-0 pb-2 pt-1 font-normal data-active:font-semibold group-data-[variant=line]/tabs-list:data-active:after:bg-primary",
                    tabHasError(t.value) && "text-destructive",
                  )}
                >
                  {t.label}
                </TabsTrigger>
              ))}
            </TabsList>

            <TabsContent value="other" className="space-y-3 pt-5">
              <Row label="GST Treatment" required>
                <Select value={v.gst_treatment || undefined} onValueChange={setGstTreatment}>
                  <SelectTrigger className={cn("w-full", FIELD_W)}><SelectValue placeholder="Select a GST treatment" /></SelectTrigger>
                  <SelectContent>
                    {GST_TREATMENTS.map((t) => (
                      <SelectItem key={t.value} value={t.value}>
                        <span className="flex flex-col">
                          <span>{t.label}</span>
                          <span className="text-xs text-muted-foreground">{t.hint}</span>
                        </span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <FieldError msg={errors.gst_treatment} />
              </Row>
              {registered && (
                <Row label="GSTIN" required hint="15-character GST Identification Number.">
                  <div className={cn("flex gap-2", FIELD_W)}>
                    <Input value={v.gst_number} maxLength={15} placeholder="e.g. 09AAICD2790D1ZM" onChange={(e) => setGstNumber(e.target.value)} />
                    <Button type="button" variant="outline" disabled={gstFetching || !v.gst_number.trim()} onClick={() => handleFetchGst()}>
                      {gstFetching ? <Loader2 className="h-4 w-4 animate-spin" /> : "Fetch"}
                    </Button>
                  </div>
                  <FieldError msg={errors.gst_number} />
                </Row>
              )}
              <Row label="Place of Supply" required>
                <div className={FIELD_W}>
                  <StateSelect value={v.state_code} onChange={setPlaceOfSupply} placeholder="" />
                </div>
                <FieldError msg={errors.state_code} />
              </Row>
              <Row label="PAN" hint="Filled automatically from the GSTIN.">
                <Input className={FIELD_W} maxLength={10} value={v.pan} onChange={(e) => set("pan", e.target.value.toUpperCase())} />
                <FieldError msg={errors.pan} />
              </Row>
              <Row label="Email 2">
                <Input className={FIELD_W} type="email" value={v.alt_email} onChange={(e) => set("alt_email", e.target.value)} />
                <FieldError msg={errors.alt_email} />
              </Row>
              <Row label="Source">
                <Input className={FIELD_W} value={v.source} onChange={(e) => set("source", e.target.value)} />
              </Row>
              <Row label="Social Following">
                <Select value={v.social_following} onValueChange={(val) => set("social_following", val)}>
                  <SelectTrigger className={cn("w-full", FIELD_W)}><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {["FB", "Insta", "Both", "None"].map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                  </SelectContent>
                </Select>
              </Row>
              <Row label="Google Review">
                <label className="flex h-8 cursor-pointer items-center gap-2 text-sm">
                  <Checkbox checked={v.google_review} onCheckedChange={(c) => set("google_review", !!c)} />
                  Customer has left a Google review
                </label>
              </Row>
            </TabsContent>

            <TabsContent value="address" className="pt-5">
              <div className="grid max-w-[1050px] grid-cols-1 gap-x-12 gap-y-8 @3xl:grid-cols-2">
                <div>
                  <h4 className="mb-4 text-base font-semibold">Billing Address</h4>
                  {addressBlock("billing")}
                </div>
                <div>
                  <h4 className="mb-4 flex flex-wrap items-center gap-1 text-base font-semibold">
                    Shipping Address
                    <button type="button" onClick={copyBilling} className="inline-flex items-center gap-0.5 text-sm font-normal text-primary hover:underline">
                      (<ArrowDown className="h-3.5 w-3.5" />Copy billing address)
                    </button>
                  </h4>
                  {addressBlock("shipping")}
                </div>
              </div>
              <div className="mt-6 max-w-[1050px] border-l-2 border-warning pl-3 text-xs text-muted-foreground">
                Leave the shipping address blank to ship to the billing address. Invoices, quotations and proformas copy
                both addresses when they are created, so editing them here later doesn&apos;t change documents already issued.
              </div>
            </TabsContent>

            <TabsContent value="contacts" className="pt-5">
              {/* Table on wide containers (Zoho), one stacked card per contact when narrow. */}
              <div className="max-w-[1050px] rounded-md border">
                <div className="hidden grid-cols-[104px_1fr_1fr_1.3fr_1.2fr_1.2fr_36px] border-b bg-muted/50 text-[11px] font-medium uppercase tracking-wide text-muted-foreground @3xl:grid">
                  {["Salutation", "First Name", "Last Name", "Email Address", "Work Phone", "Mobile", ""].map((h, i) => (
                    <div key={i} className="border-r px-2 py-2 last:border-r-0">{h}</div>
                  ))}
                </div>
                {v.contact_persons.length === 0 && (
                  <p className="px-3 py-4 text-sm text-muted-foreground">No contact persons added.</p>
                )}
                {v.contact_persons.map((p, i) => (
                  <div key={i} className="grid grid-cols-1 gap-2 border-b p-3 last:border-b-0 @md:grid-cols-2 @3xl:grid-cols-[104px_1fr_1fr_1.3fr_1.2fr_1.2fr_36px] @3xl:gap-0 @3xl:p-0 [&>*]:@3xl:border-r [&>*:last-child]:@3xl:border-r-0 @3xl:[&_input]:rounded-none @3xl:[&_input]:border-0 @3xl:[&_input]:shadow-none @3xl:[&_span]:border-0 @3xl:[&_span]:rounded-none @3xl:[&_button]:border-0 @3xl:[&_button]:shadow-none @3xl:[&_button]:rounded-none">
                    <Select value={p.salutation || undefined} onValueChange={(val) => updateContact(i, "salutation", val)}>
                      <SelectTrigger className="w-full"><SelectValue placeholder="Salutation" /></SelectTrigger>
                      <SelectContent>{SALUTATIONS.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
                    </Select>
                    <Input placeholder="First Name" value={p.first_name} onChange={(e) => updateContact(i, "first_name", e.target.value)} />
                    <Input placeholder="Last Name" value={p.last_name} onChange={(e) => updateContact(i, "last_name", e.target.value)} />
                    <Input type="email" placeholder="Email Address" value={p.email} onChange={(e) => updateContact(i, "email", e.target.value)} />
                    <PhoneInput value={p.work_phone} onChange={(val) => updateContact(i, "work_phone", val)} placeholder="Work Phone" />
                    <PhoneInput value={p.mobile} onChange={(val) => updateContact(i, "mobile", val)} placeholder="Mobile" />
                    <div className="flex items-center justify-end @3xl:justify-center">
                      <Button type="button" variant="ghost" size="sm" aria-label="Remove contact" onClick={() => set("contact_persons", v.contact_persons.filter((_, j) => j !== i))}>
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
              <Button type="button" variant="secondary" size="sm" className="mt-3" onClick={() => set("contact_persons", [...v.contact_persons, { ...emptyContact }])}>
                <PlusCircle className="mr-1 h-4 w-4 text-primary" /> Add Contact Person
              </Button>
            </TabsContent>

            <TabsContent value="remarks" className="space-y-1.5 pt-5">
              <Label className="font-normal">Remarks <span className="text-muted-foreground">(For Internal Use)</span></Label>
              <Textarea rows={3} className="max-w-[690px]" value={v.remarks} onChange={(e) => set("remarks", e.target.value)} />
            </TabsContent>
          </Tabs>

          {duplicateWarning && (
            <p className="text-xs text-warning bg-warning/10 rounded px-3 py-2">{duplicateWarning}</p>
          )}
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-2 border-t bg-popover px-6 py-3">
        <Button type="submit" loading={saving}>{submitLabel}</Button>
        <Button type="button" variant="outline" onClick={onCancel} disabled={saving}>Cancel</Button>
      </div>
    </form>
  );
}
