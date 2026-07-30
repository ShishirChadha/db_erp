"use client";

import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useAsyncAction } from "@/lib/useAsyncAction";

export default function DeleteRecordDialog({
  title,
  identifier,
  open,
  onOpenChange,
  onConfirm,
}: {
  title: string;
  identifier: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: (remarks: string) => void | Promise<void>;
}) {
  const [remarks, setRemarks] = useState("");

  const { run: handleConfirm, pending } = useAsyncAction(async () => {
    await onConfirm(remarks);
    setRemarks("");
    onOpenChange(false);
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}: {identifier}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div>
            <Label htmlFor="remarks">Reason / Remarks (optional)</Label>
            <Textarea
              id="remarks"
              value={remarks}
              onChange={(e) => setRemarks(e.target.value)}
              placeholder="Why are you deleting this record?"
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={pending}>
            Cancel
          </Button>
          <Button variant="destructive" onClick={() => handleConfirm()} loading={pending}>
            Delete Permanently
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}