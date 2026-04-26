'use client';
import { useState, useEffect } from 'react';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Plus, Search } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { toast } from 'sonner';

export default function VendorsPage() {
  const [vendors, setVendors] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [openModal, setOpenModal] = useState(false);
  const [newVendor, setNewVendor] = useState({ company_name: '', spoc_name: '', phone: '', email: '' });

  const fetchVendors = async () => {
    const res = await fetch('/api/vendors');
    const data = await res.json();
    if (res.ok) setVendors(data);
    setLoading(false);
  };

  useEffect(() => { fetchVendors(); }, []);

  const filtered = vendors.filter(v => 
    v.company_name.toLowerCase().includes(search.toLowerCase()) ||
    v.vendor_code?.toLowerCase().includes(search.toLowerCase())
  );

  const handleAddVendor = async () => {
    if (!newVendor.company_name) return toast.error('Company name required');
    const res = await fetch('/api/vendors', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(newVendor)
    });
    if (res.ok) {
      toast.success('Vendor added');
      setOpenModal(false);
      setNewVendor({ company_name: '', spoc_name: '', phone: '', email: '' });
      fetchVendors();
    } else {
      toast.error('Failed to add vendor');
    }
  };

  return (
    <div className="p-4 space-y-4">
      <div className="flex justify-between items-center">
        <h1 className="text-2xl font-bold">Vendors</h1>
        <Button onClick={() => setOpenModal(true)}><Plus className="mr-2 h-4 w-4" /> Add Vendor</Button>
      </div>
      <div className="flex gap-2">
        <Input placeholder="Search by name or code..." value={search} onChange={e => setSearch(e.target.value)} className="max-w-sm" />
      </div>
      <div className="border rounded-md">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Vendor Code</TableHead>
              <TableHead>Company Name</TableHead>
              <TableHead>Contact Person</TableHead>
              <TableHead>Email</TableHead>
              <TableHead>Phone</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.map(v => (
              <TableRow key={v.id}>
                <TableCell className="font-mono">{v.vendor_code || '—'}</TableCell>
                <TableCell>{v.company_name}</TableCell>
                <TableCell>{v.spoc_name || '-'}</TableCell>
                <TableCell>{v.email || '-'}</TableCell>
                <TableCell>{v.phone || '-'}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <Dialog open={openModal} onOpenChange={setOpenModal}>
        <DialogContent>
          <DialogHeader><DialogTitle>Add New Vendor</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div><Label>Company Name *</Label><Input value={newVendor.company_name} onChange={e => setNewVendor({...newVendor, company_name: e.target.value})} /></div>
            <div><Label>Contact Person</Label><Input value={newVendor.spoc_name} onChange={e => setNewVendor({...newVendor, spoc_name: e.target.value})} /></div>
            <div><Label>Phone</Label><Input value={newVendor.phone} onChange={e => setNewVendor({...newVendor, phone: e.target.value})} /></div>
            <div><Label>Email</Label><Input type="email" value={newVendor.email} onChange={e => setNewVendor({...newVendor, email: e.target.value})} /></div>
          </div>
          <DialogFooter><Button onClick={handleAddVendor}>Save</Button><Button variant="outline" onClick={() => setOpenModal(false)}>Cancel</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}