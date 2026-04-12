"use client";

import { useState, useEffect } from "react";
import { createClient } from "@/lib/supabase/client";
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

interface Item {
  id: string;
  type: "asset";
  identifier: string;
  description: string;
  price: number;
  gst_rate: number;
}

export function SearchableItemSelect({ onSelect }: { onSelect: (item: Item | null) => void }) {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<Item[]>([]);
  const [searchTerm, setSearchTerm] = useState("");
  const [loading, setLoading] = useState(false);
  const supabase = createClient();

  useEffect(() => {
    const fetchAssets = async () => {
      setLoading(true);
      try {
        let query = supabase
          .from("purchases")
          .select("id, asset_number, sku, asset_description, total_price, purchase_date")
          .eq("is_deleted", false)
          .order("purchase_date", { ascending: false }); // Latest first

        if (searchTerm) {
          query = query.or(
            `asset_number.ilike.%${searchTerm}%,` +
            `sku.ilike.%${searchTerm}%,` +
            `asset_description.ilike.%${searchTerm}%`
          );
        }

        const { data, error } = await query.limit(100);

        if (error) {
          console.error("Error fetching purchases:", error);
          setItems([]);
          return;
        }

        if (data && data.length > 0) {
          const mapped = data.map((item) => {
            // Build a rich description: Model (SKU) - CPU/RAM/SSD
            const model = item.sku || "";
            const specs = item.asset_description || "";
            const description = `${model} ${specs}`.trim();
            return {
              id: item.id,
              type: "asset" as const,
              identifier: item.asset_number,
              description: description || item.asset_number,
              price: item.total_price || 0,
              gst_rate: 18,
            };
          });
          setItems(mapped);
        } else {
          setItems([]);
        }
      } catch (err) {
        console.error(err);
        setItems([]);
      } finally {
        setLoading(false);
      }
    };

    fetchAssets();
  }, [searchTerm, supabase]);

  const handleSelect = (item: Item) => {
    onSelect(item);
    setOpen(false);
    setSearchTerm("");
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" role="combobox" className="w-full justify-between">
          {loading ? "Loading..." : "Search and select item..."}
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[500px] p-0">
        <Command>
          <CommandInput
            placeholder="Search by asset number, model, or description..."
            value={searchTerm}
            onValueChange={setSearchTerm}
          />
          <CommandList>
            {loading && <CommandEmpty>Loading...</CommandEmpty>}
            {!loading && items.length === 0 && (
              <CommandEmpty>No assets found. Make sure you have purchases in the database.</CommandEmpty>
            )}
            <CommandGroup heading="Assets (Laptops/Desktops)">
              {items.map((item) => (
                <CommandItem
                  key={item.id}
                  value={item.identifier}
                  onSelect={() => handleSelect(item)}
                >
                  <div className="flex flex-col">
                    <span className="font-medium">{item.identifier}</span>
                    <span className="text-sm text-muted-foreground">
                      {item.description} - ₹{item.price.toFixed(2)}
                    </span>
                  </div>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}