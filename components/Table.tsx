/** The first cell of each row is its header; the other columns are right-aligned numbers. */
export function Table({ headers, rows }: { headers: string[]; rows: string[][] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-sm">
        <thead className="bg-zinc-50 text-zinc-500 dark:bg-zinc-900">
          <tr>
            {headers.map((h, i) => (
              <th key={h} scope="col" className={`px-4 py-2 font-medium ${i > 0 ? "text-right" : ""}`}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
          {rows.map(([header, ...cells]) => (
            <tr key={header}>
              <th scope="row" className="px-4 py-2 font-normal">
                {header}
              </th>
              {cells.map((cell, i) => (
                <td key={i} className="px-4 py-2 text-right tabular-nums">
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
