"use client";

import { useState, useEffect, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";
import { Check, ChevronsUpDown, Plus } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

// Normalize model name (trim, remove extra spaces, title case)
function normalizeModelName(input: string): string {
  return input
    .trim()
    .replace(/\s+/g, " ")
    .split(" ")
    .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(" ")
    .replace(/Thinkpad/i, "ThinkPad")
    .replace(/T450/i, "T450");
}

export function ModelSelect({
  value,
  onChange,
}: {
  value: string | null;
  onChange: (modelId: string | null, modelName: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [models, setModels] = useState<{ id: string; name: string }[]>([]);
  const [searchTerm, setSearchTerm] = useState("");
  const [isAddingNew, setIsAddingNew] = useState(false);
  const [newModelName, setNewModelName] = useState("");
  const [loading, setLoading] = useState(false);
  const supabase = createClient();

  const fetchModels = useCallback(async () => {
    let query = supabase.from("models").select("id, name").order("name");
    if (searchTerm) {
      query = query.ilike("name", `%${searchTerm}%`);
    }
    const { data, error } = await query.limit(50);
    if (!error && data) setModels(data);
  }, [searchTerm, supabase]);

  useEffect(() => {
    fetchModels();
  }, [fetchModels]);

  const handleAddNewModel = async () => {
    if (!newModelName.trim()) return;
    setLoading(true);
    const normalized = normalizeModelName(newModelName);
    // Check if it already exists
    const { data: existing } = await supabase
      .from("models")
      .select("id, name")
      .eq("name", normalized)
      .maybeSingle();
    if (existing) {
      onChange(existing.id, existing.name);
      setIsAddingNew(false);
      setNewModelName("");
      setLoading(false);
      setOpen(false);
      return;
    }
    // Insert new model
    const { data, error } = await supabase
      .from("models")
      .insert({ name: normalized })
      .select()
      .single();
    if (error) {
      alert("Failed to add model: " + error.message);
    } else {
      onChange(data.id, data.name);
      setIsAddingNew(false);
      setNewModelName("");
      setOpen(false);
      // Refresh list
      fetchModels();
    }
    setLoading(false);
  };

  const selectedModel = models.find(m => m.id === value);

  return (
    <>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            variant="outline"
            role="combobox"
            className="w-full justify-between"
          >
            {selectedModel ? selectedModel.name : "Select or type new model..."}
            <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-[400px] p-0">
          <Command>
            <CommandInput
              placeholder="Search existing models or type new..."
              value={searchTerm}
              onValueChange={setSearchTerm}
            />
            <CommandList>
              <CommandEmpty>
                No model found.
                <Button
                  variant="link"
                  size="sm"
                  onClick={() => setIsAddingNew(true)}
                  className="ml-2"
                >
                  <Plus className="mr-1 h-3 w-3" /> Add "{searchTerm}"
                </Button>
              </CommandEmpty>
              <CommandGroup heading="Existing models">
                {models.map((model) => (
                  <CommandItem
                    key={model.id}
                    value={model.name}
                    onSelect={() => {
                      onChange(model.id, model.name);
                      setOpen(false);
                    }}
                  >
                    <Check
                      className={cn(
                        "mr-2 h-4 w-4",
                        value === model.id ? "opacity-100" : "opacity-0"
                      )}
                    />
                    {model.name}
                  </CommandItem>
                ))}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>

      {/* Dialog for adding a new model manually */}
      <Dialog open={isAddingNew} onOpenChange={setIsAddingNew}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add New Model</DialogTitle>
            <DialogDescription>
              Enter the model name exactly as it should appear.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>Model Name</Label>
              <Input
                value={newModelName}
                onChange={(e) => setNewModelName(e.target.value)}
                placeholder="e.g., ThinkPad T450"
              />
              <p className="text-xs text-muted-foreground mt-1">
                Will be normalized (e.g., "thinkpad t450" → "ThinkPad T450").
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsAddingNew(false)}>
              Cancel
            </Button>
            <Button onClick={handleAddNewModel} disabled={loading}>
              {loading ? "Adding..." : "Add Model"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}