"use client";

import { useState } from "react";
import { Check, ChevronsUpDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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

const OTHER = "__other__";

// Generic searchable dropdown for short-to-medium option lists (CPU, generation, RAM,
// storage, screen size, etc.) backed by useCustomOptions(category). Falls back to a
// free-text field when the picked value isn't in the list ("Other"), so an unusual
// unit never blocks the form -- it just doesn't feed the canonical list back in.
export function SearchableSelect({
  options,
  value,
  onChange,
  placeholder = "Select...",
  allowOther = true,
  otherPosition = "bottom",
}: {
  options: string[];
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  allowOther?: boolean;
  otherPosition?: "top" | "bottom";
}) {
  const [open, setOpen] = useState(false);
  const isCustomValue = value !== "" && !options.includes(value);
  const [usingOther, setUsingOther] = useState(isCustomValue);

  if (usingOther) {
    return (
      <div className="flex gap-1">
        <Input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="Type value..."
          autoFocus
        />
        <Button type="button" variant="outline" size="sm" onClick={() => { setUsingOther(false); onChange(""); }}>
          List
        </Button>
      </div>
    );
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" role="combobox" className="w-full justify-between font-normal">
          {value || placeholder}
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[300px] p-0">
        <Command>
          <CommandInput placeholder="Search..." />
          <CommandList>
            <CommandEmpty>No match.</CommandEmpty>
            <CommandGroup>
              {allowOther && otherPosition === "top" && (
                <CommandItem
                  value={OTHER}
                  onSelect={() => { setUsingOther(true); onChange(""); setOpen(false); }}
                >
                  Other...
                </CommandItem>
              )}
              {options.map((opt) => (
                <CommandItem
                  key={opt}
                  value={opt}
                  onSelect={() => { onChange(opt); setOpen(false); }}
                >
                  <Check className={cn("mr-2 h-4 w-4", value === opt ? "opacity-100" : "opacity-0")} />
                  {opt}
                </CommandItem>
              ))}
              {allowOther && otherPosition === "bottom" && (
                <CommandItem
                  value={OTHER}
                  onSelect={() => { setUsingOther(true); onChange(""); setOpen(false); }}
                >
                  Other...
                </CommandItem>
              )}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
