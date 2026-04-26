'use client';
import { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

export default function SkuBaseFormModal({ open, onOpenChange, onCreated }: any) {
  const [loading, setLoading] = useState(false);
  const [form, setForm] = useState({
    sku_base: '',
    product_name: '',
    brand: '',
    category: ''
  });

  const handleSubmit = async () => {
    if (!form.sku_base || !form.product_name) {
      alert('SKU base and product name are required');
      return;
    }
    setLoading(true);
    const res = await fetch('/api/skus', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'base', ...form })
    });
    if (res.ok) {
      onCreated();
      onOpenChange(false);
      setForm({ sku_base: '', product_name: '', brand: '', category: '' });
    } else {
      alert('Failed to create SKU base');
    }
    setLoading(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader><DialogTitle>Add New SKU Base</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div><Label>SKU Base *</Label><Input value={form.sku_base} onChange={e => setForm({...form, sku_base: e.target.value})} placeholder="e.g., SKU-LAP-DELL-LAT-5400" /></div>
          <div><Label>Product Name *</Label><Input value={form.product_name} onChange={e => setForm({...form, product_name: e.target.value})} /></div>
          <div><Label>Brand</Label><Input value={form.brand} onChange={e => setForm({...form, brand: e.target.value})} /></div>
          <div><Label>Category</Label>
            <Select value={form.category} onValueChange={v => setForm({...form, category: v})}>
              <SelectTrigger><SelectValue placeholder="Select category" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="Laptop">Laptop</SelectItem>
                <SelectItem value="Desktop">Desktop</SelectItem>
                <SelectItem value="Monitor">Monitor</SelectItem>
                <SelectItem value="RAM">RAM</SelectItem>
                <SelectItem value="SSD">SSD</SelectItem>
                <SelectItem value="Keyboard">Keyboard</SelectItem>
                <SelectItem value="Mouse">Mouse</SelectItem>
                <SelectItem value="Cable">Cable</SelectItem>
                <SelectItem value="Charger">Charger</SelectItem>
                <SelectItem value="Battery">Battery</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={handleSubmit} disabled={loading}>Save</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}