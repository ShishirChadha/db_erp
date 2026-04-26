'use client';

import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Plus, Trash2, Search } from 'lucide-react';
import { toast } from 'sonner';

export default function SkusPage() {
  const [skus, setSkus] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [openBaseModal, setOpenBaseModal] = useState(false);
  const [baseForm, setBaseForm] = useState({ sku_base: '', product_name: '', brand: '', category: '' });

  const fetchSkus = async () => {
    const res = await fetch('/api/skus');
    if (res.ok) {
      const data = await res.json();
      setSkus(data);
    }
    setLoading(false);
  };

  useEffect(() => { fetchSkus(); }, []);

  const handleAddBase = async () => {
    if (!baseForm.sku_base || !baseForm.product_name) {
      return toast.error('SKU base and product name required');
    }
    const res = await fetch('/api/skus', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'base', ...baseForm })
    });
    const data = await res.json();
    if (res.ok) {
      toast.success('SKU base added');
      setOpenBaseModal(false);
      setBaseForm({ sku_base: '', product_name: '', brand: '', category: '' });
      fetchSkus();
    } else {
      toast.error(data.error || 'Failed to add SKU base');
    }
  };

  const handleDeleteBase = async (id: string) => {
    if (!confirm('Delete this base?')) return;
    const res = await fetch(`/api/skus/base/${id}`, { method: 'DELETE' });
    if (res.ok) {
      toast.success('Deleted');
      fetchSkus();
    } else {
      toast.error('Delete failed');
    }
  };

  const filteredSkus = skus.filter(base =>
    base.sku_base?.toLowerCase().includes(search.toLowerCase()) ||
    base.product_name?.toLowerCase().includes(search.toLowerCase())
  );

  if (loading) return <div>Loading...</div>;

  return (
    <div className="space-y-4 p-4">
      <div className="flex justify-between items-center">
        <h1 className="text-2xl font-bold">SKU Management</h1>
        <Button onClick={() => setOpenBaseModal(true)}><Plus className="mr-2 h-4 w-4" /> Add SKU Base</Button>
      </div>
      <div className="flex gap-2">
        <Input placeholder="Search SKU..." value={search} onChange={e => setSearch(e.target.value)} className="max-w-sm" />
      </div>
      <div className="border rounded-md overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>SKU Base</TableHead>
              <TableHead>Product Name</TableHead>
              <TableHead>Brand</TableHead>
              <TableHead>Category</TableHead>
              <TableHead>Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filteredSkus.map(base => (
              <TableRow key={base.id}>
                <TableCell className="font-mono text-sm">{base.sku_base}</TableCell>
                <TableCell>{base.product_name}</TableCell>
                <TableCell>{base.brand || '-'}</TableCell>
                <TableCell>{base.category || '-'}</TableCell>
                <TableCell>
                  <Button size="sm" variant="ghost" onClick={() => handleDeleteBase(base.id)}><Trash2 className="h-4 w-4" /></Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <Dialog open={openBaseModal} onOpenChange={setOpenBaseModal}>
        <DialogContent>
          <DialogHeader><DialogTitle>Add SKU Base</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div><Label>SKU Base *</Label><Input value={baseForm.sku_base} onChange={e => setBaseForm({...baseForm, sku_base: e.target.value})} placeholder="e.g., SKU-LAP-DELL-LAT-5400" /></div>
            <div><Label>Product Name *</Label><Input value={baseForm.product_name} onChange={e => setBaseForm({...baseForm, product_name: e.target.value})} /></div>
            <div><Label>Brand</Label><Input value={baseForm.brand} onChange={e => setBaseForm({...baseForm, brand: e.target.value})} /></div>
            <div><Label>Category</Label>
              <Select value={baseForm.category} onValueChange={v => setBaseForm({...baseForm, category: v})}>
                <SelectTrigger><SelectValue placeholder="Select category" /></SelectTrigger>
                <SelectContent>
                  {['Laptop','Desktop','Monitor','RAM','SSD','Keyboard','Mouse','Cable','Charger','Battery','Other'].map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button onClick={handleAddBase}>Save</Button>
            <Button variant="outline" onClick={() => setOpenBaseModal(false)}>Cancel</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}