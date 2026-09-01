"use client";

import { useState } from "react";
import { Loader2, Upload, Eye, X } from "lucide-react";
import { apiFetch } from "@/lib/api-client";
import { Label } from "@/components/ui/label";

export type ExpenseAttachment = { key: string; name: string; size: number };

// Shared by AddExpenseDialog/EditExpenseDialog -- uploads happen immediately
// (signed-URL flow, bucket 'expense-receipts'), but the resulting {key,name,size}
// only lands in the expense row when the parent form's own submit includes this
// field's `value` in its request body. Add has no expense id yet to attach to
// separately, so this can't save itself the way AttachInvoiceFileDialog does.
export function ExpenseAttachmentsField({
  value,
  onChange,
}: {
  value: ExpenseAttachment[];
  onChange: (next: ExpenseAttachment[]) => void;
}) {
  const [uploading, setUploading] = useState(false);
  const [err, setErr] = useState("");

  const handleFile = async (file: File | null) => {
    if (!file) return;
    setErr("");
    setUploading(true);
    try {
      const res = await apiFetch("/api/storage/upload-url", {
        method: "POST",
        body: JSON.stringify({ fileName: file.name, contentType: file.type, folder: "receipts", fileType: "receipt", bucket: "expense-receipts" }),
      });
      if (!res.ok) throw new Error();
      const { uploadUrl, key } = await res.json();
      await fetch(uploadUrl, { method: "PUT", body: file, headers: { "Content-Type": file.type } });
      onChange([...value, { key, name: file.name, size: file.size }]);
    } catch {
      setErr("Upload failed. Try again.");
    } finally {
      setUploading(false);
    }
  };

  const viewFile = async (key: string) => {
    const res = await apiFetch("/api/storage/download-url", {
      method: "POST",
      body: JSON.stringify({ key, expiresIn: 300, bucket: "expense-receipts" }),
    });
    if (!res.ok) { alert("Failed to open file."); return; }
    const { url } = await res.json();
    window.open(url, "_blank");
  };

  const removeFile = async (key: string) => {
    onChange(value.filter((a) => a.key !== key));
    apiFetch("/api/storage/delete", {
      method: "DELETE",
      body: JSON.stringify({ key, bucket: "expense-receipts" }),
    }).catch(() => {});
  };

  return (
    <div className="col-span-2">
      <Label>Receipts / Attachments</Label>
      {value.length > 0 && (
        <ul className="text-sm border rounded divide-y mb-2">
          {value.map((a) => (
            <li key={a.key} className="px-2 py-1 flex items-center justify-between gap-2">
              <span className="truncate">{a.name}</span>
              <span className="flex items-center gap-2 shrink-0">
                <button type="button" onClick={() => viewFile(a.key)} className="text-blue-600 underline text-xs inline-flex items-center gap-1">
                  <Eye className="h-3 w-3" /> View
                </button>
                <button type="button" onClick={() => removeFile(a.key)} className="text-red-600 text-xs inline-flex items-center gap-1">
                  <X className="h-3 w-3" /> Remove
                </button>
              </span>
            </li>
          ))}
        </ul>
      )}
      <label className="text-xs text-gray-600 flex items-center gap-1 cursor-pointer border rounded px-2 py-1 hover:bg-gray-50 w-fit">
        {uploading ? <Loader2 className="h-3 w-3 animate-spin" /> : <Upload className="h-3 w-3" />}
        {uploading ? "Uploading…" : "Attach file"}
        <input type="file" className="hidden" disabled={uploading} onChange={(e) => handleFile(e.target.files?.[0] || null)} />
      </label>
      {err && <div className="text-red-600 text-xs mt-1">{err}</div>}
    </div>
  );
}
