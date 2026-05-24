import type { Metadata } from "next";
import Link from "next/link";
import { Gentium_Plus, Inter_Tight, Spectral } from "next/font/google";
import "./globals.css";

export const metadata: Metadata = {
  title: "TextLab Bible",
  description: "A sample-data Bible text lab for Greek and English study."
};

const display = Spectral({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-display",
  display: "swap"
});

const sans = Inter_Tight({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-sans",
  display: "swap"
});

const greek = Gentium_Plus({
  subsets: ["greek", "greek-ext", "latin"],
  weight: ["400", "700"],
  variable: "--font-greek",
  display: "swap"
});

const nav = [
  { href: "/read", label: "Reader" },
  { href: "/search", label: "Search" },
  { href: "/notes", label: "Notes" },
  { href: "/assistant", label: "Assistant" }
];

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${display.variable} ${sans.variable} ${greek.variable}`}>
      <body className="min-h-screen font-sans">
        <header className="border-b border-stone-300 bg-white/90 backdrop-blur">
          <div className="mx-auto flex max-w-6xl flex-col gap-4 px-4 py-4 sm:flex-row sm:items-center sm:justify-between">
            <Link href="/read" className="font-display text-xl font-semibold tracking-tight text-slate-900">
              TextLab Bible
            </Link>
            <nav className="flex flex-wrap gap-2 text-sm">
              {nav.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  className="rounded-md border border-stone-300 px-3 py-2 text-slate-700 transition-colors hover:border-accent-600 hover:bg-accent-50 hover:text-accent-800"
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
