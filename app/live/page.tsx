import type { Metadata } from "next";
import { LiveTable } from "@/components/LiveTable";

export const metadata: Metadata = {
  title: "Live · gridviz",
  description: "Live prices, demand and interconnector flows in the National Electricity Market",
};

export default function Live() {
  return (
    <div className="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-8 px-6 py-16 font-sans">
      <section className="flex flex-col gap-4">
        <h1 className="text-4xl font-semibold tracking-tight">Live NEM</h1>
        <p className="max-w-2xl text-lg leading-8 text-zinc-600 dark:text-zinc-400">
          Spot prices, demand and interconnector flows from AEMO&apos;s latest 5-minute dispatch.
          The page refreshes every minute. Data from{" "}
          <a
            href="https://nemweb.com.au/Reports/Current/DispatchIS_Reports/"
            target="_blank"
            rel="noopener noreferrer"
            className="underline underline-offset-4 hover:text-foreground"
          >
            AEMO NEMWeb
          </a>
          .
        </p>
      </section>
      <LiveTable />
    </div>
  );
}
