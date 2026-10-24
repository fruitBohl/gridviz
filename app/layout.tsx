import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { Navbar } from "@/components/Navbar";

import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "gridviz",
  description: "Visualising Australia's National Electricity Market",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <a
          href="#main"
          className="sr-only rounded-md bg-foreground px-4 py-2 font-sans text-sm text-background focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-100"
        >
          Skip to content
        </a>
        <Navbar />
        <main id="main" className="flex flex-1 flex-col">
          {children}
        </main>
      </body>
    </html>
  );
}
