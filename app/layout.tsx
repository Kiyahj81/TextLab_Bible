import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = {
  title: "TextLab Bible",
  description: "A sample-data Bible text lab for Greek and English study."
};

const nav = [
  { href: "/read", label: "Reader" },
  { href: "/search", label: "Search" },
  { href: "/notes", label: "Notes" },
  { href: "/assistant", label: "Assistant" }
];

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body className="min-h-screen">
        <header className="border-b border-stone-300 bg-white">
          <div className="mx-auto flex max-w-6xl flex-col gap-4 px-4 py-4 sm:flex-row sm:items-center sm:justify-between">
            <Link href="/read" className="text-xl font-semibold tracking-normal text-slate-900">
              TextLab Bible
            </Link>
            <nav className="flex flex-wrap gap-2 text-sm">
              {nav.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  className="rounded-md border border-stone-300 px-3 py-2 text-slate-700 hover:border-slate-500 hover:bg-slate-50"
                >
                  {item.label}
                </Link>
              ))}
            </nav>
          </div>
        </header>
        <main className="mx-auto max-w-6xl px-4 py-6">{children}</main>
      </body>
    </html>
  );
}
