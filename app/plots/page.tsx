import type { Metadata } from "next";
import { PlotsView } from "@/components/PlotsView";

export const metadata: Metadata = {
  title: "Plots · gridviz",
  description: "Two years of NEM spot prices, demand, net interchange and interconnector flows",
};

export default function Plots() {
  return (
    <div className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-8 px-6 py-16 font-sans">
      <section className="flex flex-col gap-4">
        <h1 className="text-4xl font-semibold tracking-tight">Plots</h1>
        <p className="max-w-2xl text-lg leading-8 text-zinc-600 dark:text-zinc-400">
          Two years of AEMO&apos;s 5-minute dispatch data, from 1 October 2024 to the latest interval: daily means,
          and the most extreme days. Times are market time (AEST, no daylight saving). Data from{" "}
          <a
            href="https://nemweb.com.au/"
            target="_blank"
            rel="noopener noreferrer"
            className="underline underline-offset-4 hover:text-foreground"
          >
            AEMO NEMWeb
          </a>
          .
        </p>
      </section>
      <PlotsView />
    </div>
  );
}
