"use client";

import { useState } from "react";
import Papa from "papaparse";
import { createClient } from "@/lib/supabase/client";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Upload } from "lucide-react";
import { useAsyncAction } from "@/lib/useAsyncAction";

export default function BulkAddDialog({
  tableName,
  onAdd,
  transformRow,
  templateLink = "",
}: {
  tableName: string;
  onAdd: () => void;
  transformRow: (row: any) => any;
  templateLink?: string;
}) {
  const [open, setOpen] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const supabase = createClient();

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) setFile(e.target.files[0]);
  };

  const { run: handleUpload, pending: loading } = useAsyncAction(async () => {
    if (!file) return;
    await new Promise<void>((resolve) => {
      Papa.parse(file, {
        header: true,
        skipEmptyLines: true,
        complete: async (results) => {
          const records = results.data.map(transformRow);
          if (records.length === 0) {
            alert("No valid records found.");
            resolve();
            return;
          }
          const { error } = await supabase.from(tableName).insert(records);
          if (error) {
            console.error(error);
            alert(`Bulk insert failed: ${error.message}`);
          } else {
            setOpen(false);
            setFile(null);
            onAdd();
            alert(`Successfully added ${records.length} records.`);
          }
          resolve();
        },
        error: (err) => {
          console.error(err);
          alert("Error parsing CSV.");
          resolve();
        },
      });
    });
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline">
          <Upload className="mr-2 h-4 w-4" /> Bulk Add
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Bulk Add {tableName}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div>
            <Label>Upload CSV file</Label>
            <input type="file" accept=".csv" onChange={handleFileChange} className="mt-1" />
          </div>
          <p className="text-sm text-muted-foreground">
            CSV must have a header row. 
            {templateLink && (
              <a href={templateLink} target="_blank" rel="noopener noreferrer" className="ml-2 text-blue-500">
                Download template
              </a>
            )}
          </p>
          <div className="flex justify-end space-x-2">
            <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button onClick={() => handleUpload()} disabled={!file} loading={loading}>
              Upload
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}