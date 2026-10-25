export function Disclosure({ summary, children }: { summary: React.ReactNode; children: React.ReactNode }) {
  return (
    <details className="rounded-lg border border-zinc-200 text-sm dark:border-zinc-800">
      <summary className="cursor-pointer px-4 py-2 text-zinc-600 dark:text-zinc-400">{summary}</summary>
      {children}
    </details>
  );
}
