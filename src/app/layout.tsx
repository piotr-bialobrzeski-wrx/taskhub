import type { Metadata } from "next";
import { Atkinson_Hyperlegible, Bricolage_Grotesque } from "next/font/google";
import "./globals.css";
import "./br.css";

export const metadata: Metadata = { title: "Task Hub", description: "Zadania, kroki i agent, który je prowadzi." };

// paczka 66 (styl BR Tasks): tytuły Bricolage Grotesque, tekst Atkinson Hyperlegible (czytelny przy zmęczonych oczach)
const display = Bricolage_Grotesque({ subsets: ["latin", "latin-ext"], weight: ["500", "700"], variable: "--f-display", display: "swap" });
const body = Atkinson_Hyperlegible({ subsets: ["latin", "latin-ext"], weight: ["400", "700"], variable: "--f-body", display: "swap" });

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pl" className={`${display.variable} ${body.variable}`}>
      <body>{children}</body>
    </html>
  );
}
