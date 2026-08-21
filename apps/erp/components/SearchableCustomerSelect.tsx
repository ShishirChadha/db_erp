"use client";

import { useState, useEffect, useRef, useMemo } from "react";
import { createClient } from "@/lib/supabase/client";
import { AsyncCombobox } from "@/components/AsyncCombobox";

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
  const supabase = useMemo(() => createClient(), []);
  // Debounced + ordering-guarded: without this, every keystroke fired its own
  // uncancelled query, and a slower earlier response (e.g. a broader/empty search)
  // could resolve AFTER a later, more specific one and overwrite the correct
  // results with stale ones -- a newly-added customer could appear to "not show up"
  // even though the query that would have found it already ran and returned.
  const latestRequestId = useRef(0);

  useEffect(() => {
    const requestId = ++latestRequestId.current;
    const timer = setTimeout(async () => {
      let query = supabase
        .from("customers")
        .select("id, customer_name, gst_number, address, phone, email")
        .eq("is_deleted", false);

      if (searchTerm) {
        query = query.ilike("customer_name", `%${searchTerm}%`);
      }

      const { data } = await query.order("customer_name").limit(20);
      // A newer request has since been fired -- this response is stale, discard it.
      if (requestId !== latestRequestId.current) return;
      if (data) {
        // Derive place_of_supply from address (or GST). For now, just a placeholder.
        const enriched = data.map(c => ({
          ...c,
          place_of_supply: c.address?.split(",").pop()?.trim() || "Delhi"
        }));
        setCustomers(enriched);
      }
    }, 300);

    return () => clearTimeout(timer);
  }, [searchTerm, supabase]);

  const handleSelect = (customer: Customer) => {
    onChange(customer.id);
    onCustomerData(customer);
    setOpen(false);
  };

  return (
    <AsyncCombobox<Customer>
      open={open}
      onOpenChange={setOpen}
      triggerLabel={value ? customers.find((c) => c.id === value)?.customer_name : "Select customer..."}
      popoverWidthClassName="w-[400px]"
      searchPlaceholder="Search customers..."
      searchTerm={searchTerm}
      onSearchTermChange={setSearchTerm}
      items={customers}
      getItemKey={(c) => c.id}
      isSelected={(c) => value === c.id}
      onSelect={handleSelect}
      emptyMessage="No customer found."
      renderItem={(customer) => (
        <div className="flex flex-col">
          <span>{customer.customer_name}</span>
          {customer.gst_number && <span className="text-xs text-muted-foreground">GST: {customer.gst_number}</span>}
          {customer.place_of_supply && <span className="text-xs text-muted-foreground">Place: {customer.place_of_supply}</span>}
        </div>
      )}
    />
  );
}
