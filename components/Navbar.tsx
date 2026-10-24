import Link from "next/link";

const links = [
  { href: "/live", label: "Live" },
  { href: "/site-architecture", label: "Site Architecture" },
];

export function Navbar() {
  return (
    <nav className="sticky top-0 z-50 w-full border-b border-zinc-200 bg-background/70 backdrop-blur-md dark:border-zinc-800">
      <div className="mx-auto max-w-4xl px-6">
        <div className="flex h-16 items-center justify-between font-sans">
          <Link
            href="/"
            className="text-lg font-semibold tracking-tight transition-opacity hover:opacity-80"
          >
            gridviz
          </Link>

          <div className="flex items-center gap-6">
            {links.map(({ href, label }) => (
              <Link
                key={href}
                href={href}
                className="text-sm uppercase tracking-wide text-zinc-500 underline-offset-8 transition-colors hover:text-foreground hover:underline"
              >
                {label}
              </Link>
            ))}
          </div>
        </div>
      </div>
    </nav>
  );
}
