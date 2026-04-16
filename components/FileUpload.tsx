"use client";

import { useState, useEffect } from 'react';
import { createClient } from '@/lib/supabase/client';
import { Button } from '@/components/ui/button';
import { Upload, Loader2, FileText, Share2, Trash2, Eye } from 'lucide-react';
import { Badge } from '@/components/ui/badge';

interface FileRecord {
  id: string;
  file_name: string;
  file_path: string;
  file_type: string;
  file_size_kb: number;
}

const FILE_TYPES = [
  { value: 'invoice', label: 'Invoice' },
  { value: 'eway_bill', label: 'E-Way Bill' },
  { value: 'receipt', label: 'Receipt' },
  { value: 'other', label: 'Other' },
];

export default function FileUpload({
  purchaseId,
  assetNumber,
}: {
  purchaseId: string;
  assetNumber: string;
}) {
  const [files, setFiles] = useState<FileRecord[]>([]);
  const [uploading, setUploading] = useState(false);
  const [selectedType, setSelectedType] = useState('invoice');
  const supabase = createClient();

  const fetchFiles = async () => {
    const { data } = await supabase
      .from('purchase_files')
      .select('*')
      .eq('purchase_id', purchaseId)
      .order('created_at', { ascending: false });
    if (data) setFiles(data);
  };

  useEffect(() => {
    fetchFiles();
  }, [purchaseId]);

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);

    try {
      const res = await fetch('/api/storage/upload-url', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fileName: file.name,
          contentType: file.type,
          assetNumber,
          fileType: selectedType,
        }),
      });
      const { uploadUrl, key } = await res.json();

      await fetch(uploadUrl, {
        method: 'PUT',
        body: file,
        headers: { 'Content-Type': file.type },
      });

      await supabase.from('purchase_files').insert({
        purchase_id: purchaseId,
        asset_number: assetNumber,
        file_name: file.name,
        file_path: key,
        file_type: selectedType,
        file_size_kb: Math.round(file.size / 1024),
        storage_provider: 'supabase',
      });

      fetchFiles();
    } catch (err) {
      console.error(err);
      alert('Upload failed');
    } finally {
      setUploading(false);
    }
  };

  const handleView = async (filePath: string) => {
    const res = await fetch('/api/storage/download-url', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key: filePath, expiresIn: 300 }),
    });
    const { url } = await res.json();
    window.open(url, '_blank');
  };

  const handleShare = async (filePath: string) => {
    const res = await fetch('/api/storage/download-url', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key: filePath, expiresIn: 900 }),
    });
    const { url } = await res.json();
    await navigator.clipboard.writeText(url);
    alert('Share link copied! Valid for 15 minutes.');
  };

  const handleDelete = async (fileId: string, filePath: string) => {
    await fetch('/api/storage/delete', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key: filePath }),
    });
    await supabase.from('purchase_files').delete().eq('id', fileId);
    fetchFiles();
  };

  return (
    <div className="space-y-4">
      <div className="flex gap-2 flex-wrap">
        {FILE_TYPES.map((t) => (
          <button
            key={t.value}
            type="button"   // ✅ Prevents form submission
            onClick={() => setSelectedType(t.value)}
            className={`text-xs px-3 py-1.5 rounded-full border transition-all ${
              selectedType === t.value
                ? 'bg-blue-600 text-white border-blue-600'
                : 'border-gray-200 text-gray-600 hover:border-blue-300'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      <label className="flex items-center gap-2 cursor-pointer border-2 border-dashed border-gray-200 rounded-xl p-4 hover:border-blue-300 transition-colors">
        {uploading ? (
          <Loader2 className="h-5 w-5 text-blue-600 animate-spin" />
        ) : (
          <Upload className="h-5 w-5 text-gray-400" />
        )}
        <div>
          <p className="text-sm font-medium text-gray-700">
            {uploading ? 'Uploading...' : `Upload ${FILE_TYPES.find(t => t.value === selectedType)?.label}`}
          </p>
          <p className="text-xs text-gray-400">PDF, JPG, PNG — any size</p>
        </div>
        <input
          type="file"
          className="hidden"
          accept=".pdf,.jpg,.jpeg,.png,.webp"
          onChange={handleUpload}
          disabled={uploading}
        />
      </label>

      {files.length > 0 && (
        <div className="space-y-2">
          {files.map((f) => (
            <div key={f.id} className="flex items-center gap-3 bg-gray-50 rounded-xl px-3 py-2.5">
              <FileText className="h-4 w-4 text-gray-400 flex-shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium truncate">{f.file_name}</p>
                <p className="text-xs text-gray-400">{f.file_size_kb} KB</p>
              </div>
              <Badge className="bg-blue-50 text-blue-700 text-xs hover:bg-blue-50">
                {f.file_type}
              </Badge>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => handleView(f.file_path)}
                title="View/Download"
              >
                <Eye className="h-3.5 w-3.5 text-blue-600" />
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => handleShare(f.file_path)}
                title="Copy share link (15 min)"
              >
                <Share2 className="h-3.5 w-3.5 text-green-600" />
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => handleDelete(f.id, f.file_path)}
              >
                <Trash2 className="h-3.5 w-3.5 text-red-500" />
              </Button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}