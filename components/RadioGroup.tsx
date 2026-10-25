import { useId } from "react";

/** Native radios, not buttons, so arrow keys move the choice and the group is one Tab stop. */
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
  const name = useId();
  return (
    <fieldset className="inline-flex w-fit flex-wrap rounded-lg border border-zinc-200 p-0.5 text-sm dark:border-zinc-800">
      <legend className="sr-only">{label}</legend>
      {options.map((o) => (
        <label
          key={o.value}
          title={o.title}
          className={`cursor-pointer rounded-md px-3 py-1 has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-foreground ${
            value === o.value ? "bg-foreground text-background" : "text-zinc-600 hover:text-foreground dark:text-zinc-400"
          }`}
        >
          <input
            type="radio"
            name={name}
            value={o.value}
            checked={value === o.value}
            onChange={() => onChange(o.value)}
            aria-label={o.title}
            className="sr-only"
          />
          {o.label}
        </label>
      ))}
    </fieldset>
  );
}
