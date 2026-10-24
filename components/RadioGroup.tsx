export function RadioGroup<T extends string>({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: { value: T; label: string; title?: string }[];
  value: T;
  onChange: (value: T) => void;
}) {
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex w-fit flex-wrap rounded-lg border border-zinc-200 p-0.5 text-sm dark:border-zinc-800">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          aria-label={o.title}
          title={o.title}
          onClick={() => onChange(o.value)}
          className={`rounded-md px-3 py-1 ${
            value === o.value ? "bg-foreground text-background" : "text-zinc-600 hover:text-foreground dark:text-zinc-400"
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
