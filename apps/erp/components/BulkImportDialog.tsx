'use client';

import { useState, useMemo } from "react";
import Papa from "papaparse";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Upload } from "lucide-react";
import { apiFetch } from "@/lib/api-client";
import { useAsyncAction } from "@/lib/useAsyncAction";
import { toast } from "sonner";

export interface ImportField {
  key: string;
  label: string;
  required?: boolean;
  // Checked against the normalized header (lowercased, non-alphanumeric
  // stripped) by exact match OR substring containment either direction, so
  // "Email Id" -> "emailid" matches alias "emailid", and "Hone" (a common
  // typo for "Phone") matches via the explicit "hone" alias below.
  aliases: string[];
}

const NONE = "__none__";

function normalizeHeader(h: string): string {
  return h.toLowerCase().replace(/[^a-z0-9]/g, "");
}

// Real-world exports from building societies/contact apps never use
// consistent column names -- this import has already hit "Hone" (missing the
// "P") and "Email Id" (a space) in the same file, so auto-detection errs
// toward a generous alias list rather than an exact-match one, and the
// mapping step below always lets a human override whatever was guessed.
function guessMapping(headers: string[], fields: ImportField[]): Record<string, string> {
  const mapping: Record<string, string> = {};
  const usedHeaders = new Set<string>();
  for (const field of fields) {
    const match = headers.find((h) => {
      if (usedHeaders.has(h)) return false;
      const normalized = normalizeHeader(h);
      return field.aliases.some((a) => normalized === a || normalized.includes(a) || a.includes(normalized));
    });
    if (match) {
      mapping[field.key] = match;
      usedHeaders.add(match);
    }
  }
  return mapping;
}

export const LEAD_IMPORT_FIELDS: ImportField[] = [
  { key: "name", label: "Name", required: true, aliases: ["name", "fullname", "contactname", "residentname", "customername"] },
  { key: "phone", label: "Phone", aliases: ["phone", "mobile", "mob", "contact", "contactno", "customerno", "mobileno", "phoneno", "cell", "hone", "telephone"] },
  { key: "email", label: "Email", aliases: ["email", "emailid", "mail", "emailaddress", "mailid"] },
  { key: "address", label: "Address", aliases: ["address", "addr", "flat", "unit", "flatno", "unitno", "houseno"] },
  { key: "external_identifier", label: "Identifier (optional)", aliases: ["identifier", "id", "location", "society", "project", "reference"] },
];

// A real header row has several distinct, non-blank cells; a stray blank/title
// row above it (seen on a real import -- a fully blank row before the actual
// "DATE,CUSTOMER NAME,..." header line) does not. Scanning for this, rather
// than trusting Papa's "first line is the header" default, is what keeps a
// file like that from ever reaching the UI with empty-string column names --
// which previously crashed the page, because Radix's Select explicitly
// forbids an empty-string item value.
function extractHeaderAndRows(rows: string[][]): { headers: string[]; dataRows: Record<string, string>[] } {
  const headerRowIndex = rows.findIndex((r) => r.filter((c) => c && c.trim()).length >= 2)
  if (headerRowIndex === -1) return { headers: [], dataRows: [] }

  // Blank header cells (a trailing empty column from a trailing comma) are
  // dropped entirely rather than rendered as an unmappable "" option.
  // Duplicate header names (common in real exports) get a "(2)", "(3)" suffix
  // so every option passed to Select stays unique -- Radix silently breaks on
  // duplicate item values too, not just empty ones.
  const seen = new Map<string, number>()
  const colIndexes: number[] = []
  const headers: string[] = []
  rows[headerRowIndex].forEach((raw, i) => {
    const trimmed = (raw || "").trim()
    if (!trimmed) return
    const count = seen.get(trimmed) || 0
    seen.set(trimmed, count + 1)
    headers.push(count === 0 ? trimmed : `${trimmed} (${count + 1})`)
    colIndexes.push(i)
  })

  const dataRows = rows
    .slice(headerRowIndex + 1)
    .filter((r) => r.some((c) => c && c.trim()))
    .map((r) => {
      const obj: Record<string, string> = {}
      colIndexes.forEach((colIdx, j) => { obj[headers[j]] = r[colIdx] || "" })
      return obj
    })

  return { headers, dataRows }
}

export default function BulkImportDialog({
  open,
  onOpenChange,
  endpoint,
  fields = LEAD_IMPORT_FIELDS,
  onImported,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  endpoint: string;
  fields?: ImportField[];
  onImported: () => void;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [setName, setSetName] = useState("");
  const [description, setDescription] = useState("");
  const [headers, setHeaders] = useState<string[]>([]);
  const [rawRows, setRawRows] = useState<Record<string, string>[]>([]);
  const [mapping, setMapping] = useState<Record<string, string>>({});

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const picked = e.target.files?.[0];
    if (!picked) return;
    setFile(picked);
    // Parsed headerless (string[][]), not with Papa's own `header: true` --
    // that option trusts the literal first line as the header, and a stray
    // blank/title row above the real header (seen on a real import) would
    // otherwise reach the UI as a batch of empty-string column names. See
    // extractHeaderAndRows() for why that specifically crashes the page.
    // 'greedy' also drops whitespace-only trailing rows (a 900-row file with
    // ~700 blank rows at the end was the case that surfaced this).
    Papa.parse(picked, {
      header: false,
      skipEmptyLines: 'greedy',
      complete: (results) => {
        const { headers: detectedHeaders, dataRows } = extractHeaderAndRows(results.data as string[][]);
        if (detectedHeaders.length === 0) {
          toast.error("Could not find a header row in that file.");
          return;
        }
        setHeaders(detectedHeaders);
        setRawRows(dataRows);
        setMapping(guessMapping(detectedHeaders, fields));
      },
      error: () => toast.error("Error parsing CSV."),
    });
  };

  const requiredFieldMissing = fields.some((f) => f.required && !mapping[f.key]);

  const previewRows = useMemo(() => {
    return rawRows.slice(0, 3).map((row) => {
      const mapped: Record<string, string> = {};
      for (const f of fields) {
        const header = mapping[f.key];
        mapped[f.key] = header ? (row[header] || "") : "";
      }
      return mapped;
    });
  }, [rawRows, mapping, fields]);

  const { run: handleUpload, pending: loading } = useAsyncAction(async () => {
    if (!setName.trim() || rawRows.length === 0 || requiredFieldMissing) return;
    const rows = rawRows.map((row) => {
      const mapped: Record<string, string | null> = {};
      for (const f of fields) {
        const header = mapping[f.key];
        mapped[f.key] = header ? (row[header]?.trim() || null) : null;
      }
      return mapped;
    });
    const res = await apiFetch(endpoint, {
      method: "POST",
      body: JSON.stringify({ name: setName.trim(), description: description.trim() || undefined, rows }),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      toast.error(json.error || "Import failed.");
    } else {
      if (Array.isArray(json.duplicate_warnings) && json.duplicate_warnings.length > 0) {
        toast.warning(`Imported, but ${json.duplicate_warnings.length} phone number(s) already appear in another set.`);
      } else {
        toast.success(`Created "${json.name}" with ${json.row_count} contact(s).`);
      }
      reset();
      onOpenChange(false);
      onImported();
    }
  });

  const reset = () => {
    setFile(null);
    setSetName("");
    setDescription("");
    setHeaders([]);
    setRawRows([]);
    setMapping({});
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) reset(); onOpenChange(v); }}>
      {/*
        shadcn's DialogContent ships a built-in `sm:max-w-sm` (see packages/ui/src/components/ui/dialog.tsx).
        An unprefixed `max-w-2xl` doesn't reliably beat that at the same breakpoint, which is
        what was clipping the mapping grid's right side on desktop -- `sm:max-w-2xl` overrides
        the exact same variant instead of a different one, which tailwind-merge actually dedupes.
      */}
      <DialogContent className="w-full max-w-[95vw] sm:max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>New Lead Set</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div>
            <Label>Set name</Label>
            <Input value={setName} onChange={(e) => setSetName(e.target.value)} placeholder="e.g. Golden Data, Noida Data" className="mt-1" />
          </div>
          <div>
            <Label>Description (optional)</Label>
            <Input value={description} onChange={(e) => setDescription(e.target.value)} className="mt-1" />
          </div>
          <div>
            <Label>Upload CSV file</Label>
            <input type="file" accept=".csv" onChange={handleFileChange} className="mt-1 block text-sm" />
          </div>

          {headers.length > 0 && (
            <div className="space-y-3 border rounded-md p-3">
              <p className="text-sm font-medium">Match your columns ({rawRows.length} rows found)</p>
              <p className="text-xs text-muted-foreground">
                Auto-matched where possible -- check these are right, especially if your file uses unusual column names.
              </p>
              <div className="grid grid-cols-2 gap-3">
                {fields.map((f) => (
                  <div key={f.key}>
                    <Label className="text-xs">{f.label}{f.required ? " *" : ""}</Label>
                    <Select
                      value={mapping[f.key] || NONE}
                      onValueChange={(v) => setMapping((prev) => ({ ...prev, [f.key]: v === NONE ? "" : v }))}
                    >
                      <SelectTrigger className="h-8 mt-1"><SelectValue placeholder="Not in file" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value={NONE}>Not in file</SelectItem>
                        {/* Defensive filter -- Radix's Select throws on an empty-string item value,
                            and extractHeaderAndRows() should already guarantee this never happens. */}
                        {headers.filter(Boolean).map((h) => <SelectItem key={h} value={h}>{h}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                ))}
              </div>
              {requiredFieldMissing && (
                <p className="text-xs text-destructive">Name must be mapped to a column.</p>
              )}
              {previewRows.length > 0 && (
                <div className="overflow-x-auto rounded-md border">
                  <table className="w-full text-xs">
                    <thead className="bg-muted/50 text-left">
                      <tr>{fields.map((f) => <th key={f.key} className="p-1.5">{f.label}</th>)}</tr>
                    </thead>
                    <tbody>
                      {previewRows.map((row, i) => (
                        <tr key={i} className="border-t">
                          {fields.map((f) => <td key={f.key} className="p-1.5 truncate max-w-[140px]">{row[f.key] || <span className="text-muted-foreground">-</span>}</td>)}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          <div className="flex justify-end space-x-2">
            <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button onClick={() => handleUpload()} disabled={!file || !setName.trim() || rawRows.length === 0 || requiredFieldMissing} loading={loading}>
              <Upload className="mr-2 h-4 w-4" /> Import {rawRows.length > 0 ? `(${rawRows.length})` : ""}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
