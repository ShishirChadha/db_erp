'use client';
import { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

export default function SkuVariantFormModal({ open, onOpenChange, skuBaseId, onCreated }: any) {
  const [loading, setLoading] = useState(false);
  const [form, setForm] = useState({
    variant_code: '',
    variant_name: '',
    cpu: '',
    ram_gb: '',
    ssd_gb: '',
    screen_size: '',
    charger: true,
    has_keyboard: false,
    has_mouse: false,
    make_year: '',
    generation: '',
    unit_cost: '',
    selling_price: '',
    warranty_months: ''
  });

  const handleSubmit = async () => {
    if (!form.variant_code) {
      alert('Variant code is required');
      return;
    }
    setLoading(true);
    const payload = {
      type: 'variant',
      sku_base_id: skuBaseId,
      variant_code: form.variant_code,
      variant_name: form.variant_name,
      cpu: form.cpu || null,
      ram_gb: form.ram_gb ? parseInt(form.ram_gb) : null,
      ssd_gb: form.ssd_gb ? parseInt(form.ssd_gb) : null,
      screen_size: form.screen_size ? parseFloat(form.screen_size) : null,
      charger: form.charger,
      has_keyboard: form.has_keyboard,
      has_mouse: form.has_mouse,
      make_year: form.make_year ? parseInt(form.make_year) : null,
      generation: form.generation || null,
      unit_cost: form.unit_cost ? parseFloat(form.unit_cost) : null,
      selling_price: form.selling_price ? parseFloat(form.selling_price) : null,
      warranty_months: form.warranty_months ? parseInt(form.warranty_months) : null
    };
    const res = await fetch('/api/skus', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    if (res.ok) {
      onCreated();
      onOpenChange(false);
      setForm({
        variant_code: '', variant_name: '', cpu: '', ram_gb: '', ssd_gb: '', screen_size: '',
        charger: true, has_keyboard: false, has_mouse: false, make_year: '', generation: '',
        unit_cost: '', selling_price: '', warranty_months: ''
      });
    } else {
      alert('Failed to create variant');
    }
    setLoading(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle>Add Variant to SKU Base</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div><Label>Variant Code *</Label><Input value={form.variant_code} onChange={e => setForm({...form, variant_code: e.target.value})} placeholder="001" /></div>
          <div><Label>Variant Name</Label><Input value={form.variant_name} onChange={e => setForm({...form, variant_name: e.target.value})} placeholder="i5/8GB/256GB" /></div>
          <div><Label>CPU</Label><Input value={form.cpu} onChange={e => setForm({...form, cpu: e.target.value})} /></div>
          <div className="grid grid-cols-2 gap-2">
            <div><Label>RAM (GB)</Label><Input type="number" value={form.ram_gb} onChange={e => setForm({...form, ram_gb: e.target.value})} /></div>
            <div><Label>SSD (GB)</Label><Input type="number" value={form.ssd_gb} onChange={e => setForm({...form, ssd_gb: e.target.value})} /></div>
          </div>
          <div><Label>Screen Size (in)</Label><Input type="number" step="0.1" value={form.screen_size} onChange={e => setForm({...form, screen_size: e.target.value})} /></div>
          <div className="flex gap-4">
            <label><input type="checkbox" checked={form.charger} onChange={e => setForm({...form, charger: e.target.checked})} /> Charger</label>
            <label><input type="checkbox" checked={form.has_keyboard} onChange={e => setForm({...form, has_keyboard: e.target.checked})} /> Keyboard</label>
            <label><input type="checkbox" checked={form.has_mouse} onChange={e => setForm({...form, has_mouse: e.target.checked})} /> Mouse</label>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div><Label>Make Year</Label><Input type="number" value={form.make_year} onChange={e => setForm({...form, make_year: e.target.value})} /></div>
            <div><Label>Generation</Label><Input value={form.generation} onChange={e => setForm({...form, generation: e.target.value})} /></div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div><Label>Unit Cost (₹)</Label><Input type="number" step="0.01" value={form.unit_cost} onChange={e => setForm({...form, unit_cost: e.target.value})} /></div>
            <div><Label>Selling Price (₹)</Label><Input type="number" step="0.01" value={form.selling_price} onChange={e => setForm({...form, selling_price: e.target.value})} /></div>
          </div>
          <div><Label>Warranty (months)</Label><Input type="number" value={form.warranty_months} onChange={e => setForm({...form, warranty_months: e.target.value})} /></div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={handleSubmit} disabled={loading}>Save Variant</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}