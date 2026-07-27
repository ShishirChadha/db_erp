"use client";

import { Check, ChevronsUpDown } from "lucide-react";
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

// Shared Popover+Command scaffold behind SearchableCustomerSelect and
// SearchableItemSelect -- each still owns its own data-fetching effect and
// public props, this just collapses the duplicated combobox JSX into one
// place instead of two near-identical copies.
export function AsyncCombobox<T>({
  open,
  onOpenChange,
  triggerLabel,
  popoverWidthClassName = "w-[400px]",
  searchPlaceholder = "Search...",
  searchTerm,
  onSearchTermChange,
  items,
  getItemKey,
  isSelected,
  renderItem,
  onSelect,
  emptyMessage = "No results.",
  groupHeading,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  triggerLabel: React.ReactNode;
  popoverWidthClassName?: string;
  searchPlaceholder?: string;
  searchTerm: string;
  onSearchTermChange: (v: string) => void;
  items: T[];
  getItemKey: (item: T) => string;
  isSelected?: (item: T) => boolean;
  renderItem: (item: T) => React.ReactNode;
  onSelect: (item: T) => void;
  emptyMessage?: string;
  groupHeading?: string;
}) {
  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>
        <Button variant="outline" role="combobox" className="w-full justify-between font-normal">
          {triggerLabel}
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className={cn(popoverWidthClassName, "p-0")}>
        <Command>
          <CommandInput placeholder={searchPlaceholder} value={searchTerm} onValueChange={onSearchTermChange} />
          <CommandList>
            <CommandEmpty>{emptyMessage}</CommandEmpty>
            <CommandGroup heading={groupHeading}>
              {items.map((item) => (
                <CommandItem key={getItemKey(item)} value={getItemKey(item)} onSelect={() => onSelect(item)}>
                  {isSelected && (
                    <Check className={cn("mr-2 h-4 w-4", isSelected(item) ? "opacity-100" : "opacity-0")} />
                  )}
                  {renderItem(item)}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
