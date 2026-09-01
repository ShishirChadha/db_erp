// Shared "no rows" state for every table in the app -- several pages previously
// rendered nothing at all when a filtered/empty result set came back, which reads as
// broken rather than empty. Works with both raw <table> and the shadcn <Table>
// (TableRow/TableCell are thin <tr>/<td> wrappers, so a plain <tr>/<td> pair here
// renders identically in either).
export function EmptyTableRow({ colSpan, message = "No results found." }: { colSpan: number; message?: string }) {
  return (
    <tr>
      <td colSpan={colSpan} className="p-4 text-center text-sm text-muted-foreground">
        {message}
      </td>
    </tr>
  );
}
