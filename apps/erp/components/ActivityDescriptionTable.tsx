'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import { Trash2, Pencil, Check } from 'lucide-react';
import { buildTsvTable, parseTsvText } from '@/lib/tsv';

export interface DescriptionTableData {
  columns: string[];
  rows: string[][];
}

function padRow(row: string[], width: number): string[] {
  const c = row.slice(0, width);
  while (c.length < width) c.push('');
  return c;
}

// Parses a tab-separated clipboard paste into a table -- the first pasted row
// becomes the column headers (matching how a labeled spreadsheet range is
// normally copied), every other row is padded/truncated to that width.
export function tableFromPastedText(text: string): DescriptionTableData | null {
  if (!text.includes('\t')) return null; // a single-cell copy has no tab -- not tabular
  const rows = parseTsvText(text);
  if (rows.length === 0) return null;
  const [header, ...dataRows] = rows;
  return {
    columns: header,
    rows: dataRows.length > 0 ? dataRows.map(r => padRow(r, header.length)) : [header.map(() => '')],
  };
}

// A small ad hoc table attached to a task -- paste serials/models/etc. from a
// spreadsheet, add a column (e.g. "Status") afterward, and copy the result
// back out to paste into Excel/email/WhatsApp elsewhere.
//
// Defaults to a plain read-only <table> (real <td> text, no <input>s) so a
// manual click-drag selection across any subset of rows/columns copies
// cleanly via the browser's own copy -- selecting across separate <input>
// elements doesn't produce a usable multi-cell clipboard selection. Row/column/
// table structure changes (and cell text editing) only happen behind the
// explicit "Edit Table" toggle. Structural edits commit immediately; cell text
// edits commit on blur, so a live-persisting caller (DetailModal) isn't firing
// a network request per keystroke.
export default function ActivityDescriptionTable({
  table, onChange,
}: {
  table: DescriptionTableData | null;
  onChange: (table: DescriptionTableData | null) => void;
}) {
  const [local, setLocal] = useState<DescriptionTableData | null>(table);
  const [editing, setEditing] = useState(false);
  const current = local ?? table;

  const commit = (next: DescriptionTableData | null) => {
    setLocal(next);
    onChange(next);
  };

  const addTable = () => { commit({ columns: ['Column 1'], rows: [['']] }); setEditing(true); };

  const addColumn = () => {
    const name = window.prompt('New column name:');
    if (!name || !name.trim()) return;
    if (current) commit({ columns: [...current.columns, name.trim()], rows: current.rows.map(r => [...r, '']) });
    else commit({ columns: [name.trim()], rows: [['']] });
  };

  const removeColumn = (colIndex: number) => {
    if (!current) return;
    const columns = current.columns.filter((_, i) => i !== colIndex);
    if (columns.length === 0) { commit(null); setEditing(false); return; }
    commit({ columns, rows: current.rows.map(r => r.filter((_, i) => i !== colIndex)) });
  };

  const renameColumn = (colIndex: number, value: string) => {
    if (!current) return;
    setLocal({ ...current, columns: current.columns.map((c, i) => (i === colIndex ? value : c)) });
  };

  const addRow = () => {
    if (!current) return;
    commit({ ...current, rows: [...current.rows, current.columns.map(() => '')] });
  };

  const removeRow = (rowIndex: number) => {
    if (!current) return;
    commit({ ...current, rows: current.rows.filter((_, i) => i !== rowIndex) });
  };

  const updateCell = (rowIndex: number, colIndex: number, value: string) => {
    if (!current) return;
    setLocal({
      ...current,
      rows: current.rows.map((r, i) => (i === rowIndex ? r.map((c, j) => (j === colIndex ? value : c)) : r)),
    });
  };

  const copyTable = () => {
    if (!current) return;
    navigator.clipboard.writeText(buildTsvTable([current.columns, ...current.rows]));
    toast.success('Table copied -- paste into Excel/Numbers/email/WhatsApp.');
  };

  const clearTable = () => {
    if (!window.confirm('Remove this table?')) return;
    commit(null);
    setEditing(false);
  };

  const handlePaste = (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const parsed = tableFromPastedText(e.clipboardData.getData('text/plain'));
    if (!parsed) return; // not tabular -- let the browser's normal paste happen
    e.preventDefault();
    commit(parsed);
  };

  if (!current) {
    return (
      <div>
        <label className="block text-sm font-medium mb-1">Table (optional)</label>
        <textarea
          rows={2}
          value=""
          onChange={() => {}}
          onPaste={handlePaste}
          placeholder="Paste tabular data here (e.g. copied from Excel: Serial Number, Model...) or click + Add Table"
          className="w-full border rounded p-2 text-sm text-muted-foreground"
        />
        <button type="button" onClick={addTable} className="mt-1 text-xs px-2 py-1 border rounded hover:bg-muted">
          + Add Table
        </button>
      </div>
    );
  }

  return (
    <div>
      <div className="flex justify-between items-center mb-1">
        <label className="block text-sm font-medium">Table</label>
        <div className="flex gap-2">
          <button type="button" onClick={copyTable} className="text-xs px-2 py-1 border rounded hover:bg-muted">Copy Table</button>
          {editing ? (
            <button type="button" onClick={() => setEditing(false)} className="text-xs px-2 py-1 border rounded hover:bg-muted inline-flex items-center gap-1">
              <Check className="h-3 w-3" /> Done Editing
            </button>
          ) : (
            <button type="button" onClick={() => setEditing(true)} className="text-xs px-2 py-1 border rounded hover:bg-muted inline-flex items-center gap-1">
              <Pencil className="h-3 w-3" /> Edit Table
            </button>
          )}
        </div>
      </div>

      {editing && (
        <div className="flex gap-2 mb-1.5">
          <button type="button" onClick={addColumn} className="text-xs px-2 py-1 border rounded hover:bg-muted">+ Column</button>
          <button type="button" onClick={addRow} className="text-xs px-2 py-1 border rounded hover:bg-muted">+ Row</button>
          <button type="button" onClick={clearTable} className="text-xs px-2 py-1 border rounded text-destructive hover:bg-destructive/10">Remove Table</button>
        </div>
      )}

      <div className="border rounded overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead className="bg-muted">
            <tr>
              {current.columns.map((col, colIndex) => (
                <th key={colIndex} className="p-1 text-left">
                  {editing ? (
                    <div className="flex items-center gap-1">
                      <input
                        value={col}
                        onChange={e => renameColumn(colIndex, e.target.value)}
                        onBlur={() => commit(local)}
                        className="w-full border rounded px-1.5 py-1 text-xs font-medium bg-background"
                      />
                      <button type="button" onClick={() => removeColumn(colIndex)} className="text-muted-foreground hover:text-destructive shrink-0">
                        <Trash2 className="h-3 w-3" />
                      </button>
                    </div>
                  ) : (
                    <span className="px-1.5 py-1 text-xs font-medium block">{col}</span>
                  )}
                </th>
              ))}
              {editing && <th className="w-6"></th>}
            </tr>
          </thead>
          <tbody>
            {current.rows.map((row, rowIndex) => (
              <tr key={rowIndex} className="border-t">
                {row.map((cell, colIndex) => (
                  <td key={colIndex} className="p-1">
                    {editing ? (
                      <input
                        value={cell}
                        onChange={e => updateCell(rowIndex, colIndex, e.target.value)}
                        onBlur={() => commit(local)}
                        className="w-full border rounded px-1.5 py-1 text-xs"
                      />
                    ) : (
                      <span className="px-1.5 py-1 text-xs block">{cell}</span>
                    )}
                  </td>
                ))}
                {editing && (
                  <td className="p-1">
                    <button type="button" onClick={() => removeRow(rowIndex)} className="text-muted-foreground hover:text-destructive">
                      <Trash2 className="h-3 w-3" />
                    </button>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
