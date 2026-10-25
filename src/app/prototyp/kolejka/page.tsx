// PROTOTYP (paczka 18, krok 07 zadania „Grupy, kafelki, kolejka”): kolejka agenta w lewym dolnym rogu, warianty A (panel w rogu) i B (boczny panel),
// oraz dymek nad czatem zadania w dwóch stanach. Dane pokazowe, bez bazy i bez logowania; usunąć przed wdrożeniem.
import type { Metadata } from "next";
import { QueueProto } from "./QueueProto";

export const metadata: Metadata = { title: "Prototyp: kolejka agenta", robots: { index: false } };

export default function Page() { return <QueueProto />; }
