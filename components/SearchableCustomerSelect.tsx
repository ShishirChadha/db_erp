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

interface Customer {
  id: string;
  customer_name: string;
  gst_number: string | null;
  address: string | null;
  phone: string | null;
  email: string | null;
  place_of_supply?: string; // can be derived from address or GST
}

export function SearchableCustomerSelect({
  value,
  onChange,
  onCustomerData,
}: {
  value: string | null;
  onChange: (customerId: string | null) => void;
  onCustomerData: (customer: Customer | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [searchTerm, setSearchTerm] = useState("");
  const supabase = createClient();

  useEffect(() => {
    const fetchCustomers = async () => {
      let query = supabase
        .from("customers")
        .select("id, customer_name, gst_number, address, phone, email")
        .eq("is_deleted", false);

      if (searchTerm) {
        query = query.ilike("customer_name", `%${searchTerm}%`);
      }

      const { data } = await query.limit(20);
      if (data) {
        // Derive place_of_supply from address (or GST). For now, just a placeholder.
        const enriched = data.map(c => ({
          ...c,
          place_of_supply: c.address?.split(",").pop()?.trim() || "Delhi"
        }));
        setCustomers(enriched);
      }
    };

    fetchCustomers();
  }, [searchTerm, supabase]);

  const handleSelect = (customerId: string) => {
    const selected = customers.find((c) => c.id === customerId);
    onChange(customerId);
    onCustomerData(selected || null);
    setOpen(false);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" role="combobox" className="w-full justify-between">
          {value ? customers.find((c) => c.id === value)?.customer_name : "Select customer..."}
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[400px] p-0">
        <Command>
          <CommandInput placeholder="Search customers..." value={searchTerm} onValueChange={setSearchTerm} />
          <CommandList>
            <CommandEmpty>No customer found.</CommandEmpty>
            <CommandGroup>
              {customers.map((customer) => (
                <CommandItem key={customer.id} value={customer.id} onSelect={() => handleSelect(customer.id)}>
                  <Check className={cn("mr-2 h-4 w-4", value === customer.id ? "opacity-100" : "opacity-0")} />
                  <div className="flex flex-col">
                    <span>{customer.customer_name}</span>
                    {customer.gst_number && <span className="text-xs text-muted-foreground">GST: {customer.gst_number}</span>}
                    {customer.place_of_supply && <span className="text-xs text-muted-foreground">Place: {customer.place_of_supply}</span>}
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