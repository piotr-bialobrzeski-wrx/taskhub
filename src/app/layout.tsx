import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = { title: "Task Hub", description: "Zadania, kroki i agent, który je prowadzi." };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pl">
      <body>{children}</body>
    </html>
  );
}
