"use client";

import { useState, useEffect } from "react";
import { apiFetch } from "@/lib/api-client";
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

  useEffect(() => {
    const fetchAssets = async () => {
      setLoading(true);
      try {
        // Routed through the (now auth-gated, role-redacted) /api/stock endpoint
        // instead of a direct client-side query against `purchases` -- that query
        // exposed cost data to any logged-in session with no role check at all.
        const params = new URLSearchParams();
        if (searchTerm) params.set("search", searchTerm);
        const res = await apiFetch(`/api/stock?${params.toString()}`);

        if (!res.ok) {
          console.error("Error fetching assets:", await res.text());
          setItems([]);
          return;
        }

        const data = await res.json();

        if (data && data.length > 0) {
          const mapped = data.slice(0, 100).map((item: any) => {
            const description = `${item.sku_code || ""} ${item.description || ""}`.trim();
            return {
              id: item.id,
              type: "asset" as const,
              identifier: item.asset_number,
              description: description || item.asset_number,
              // cost_price is stripped from the response for non-owner roles --
              // falls back to 0 (employee must type the actual selling price themselves).
              price: item.unit_price ?? item.cost_price ?? 0,
              gst_rate: item.gst_percentage ?? 18,
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
  }, [searchTerm]);

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