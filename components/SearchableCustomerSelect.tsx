"use client";

import { useState, useEffect } from "react";
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
