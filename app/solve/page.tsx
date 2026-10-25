import type { Metadata } from "next";
import Link from "next/link";
import { Formulation } from "@/components/Formulation";
import { SolveView } from "@/components/SolveView";

export const metadata: Metadata = {
  title: "Solve · gridviz",
  description: "Optimise a battery against a day of NEM spot prices and turn the schedule into an AEMO bid",
};

export default function Solve() {
  return (
    <div className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-12 px-6 py-16 font-sans">
      <section className="flex flex-col gap-4">
        <h1 className="text-4xl font-semibold tracking-tight">Solve</h1>
        <p className="max-w-2xl text-lg leading-8 text-zinc-600 dark:text-zinc-400">
          With perfect hindsight, when should a 100 MW / 200 MWh battery have charged and discharged on a given day to
          earn the most? Pick a region and a day, then solve. To see the infrastructure that runs the solve, visit the{" "}
          <Link href="/site-architecture" className="underline underline-offset-4 hover:text-foreground">
            site architecture
          </Link>{" "}
          page.
        </p>
      </section>
      <SolveView />
      <Formulation />
    </div>
  );
}
