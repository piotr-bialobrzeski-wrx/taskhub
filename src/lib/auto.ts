// Automat: kto i kiedy wykonuje pracę agenta bez klucza API.
// Główna ścieżka: mostek na komputerze Piotra (jak w Project Hub) pracuje na bieżąco. Zapas: zadanie zaplanowane na jego koncie Claude co godzinę.
export const AUTO_EVERY = "co godzinę";
export const AUTO_TEXT = `Gdy mostek nie działa (komputer śpi), Claude zagląda tu ${AUTO_EVERY} z zadania zaplanowanego na Twoim koncie Claude: rozpisuje nowe zadania na kroki, robi analizy, research i szkice, a na zewnątrz wysyła tylko to, co zatwierdzisz.`;
export const BRIDGE_TEXT = "Mostek na Twoim komputerze pracuje na bieżąco: nowe zadanie dostaje kroki, analizy, research i szkice w ciągu chwili od dodania, a na zewnątrz wychodzi tylko to, co zatwierdzisz.";
// zdanie w zadaniu bez kroków
export const stepsHint = (bridgeAlive: boolean) => bridgeAlive ? "Claude rozpisze je sam za chwilę, mostek na Twoim komputerze pracuje na bieżąco." : `Claude rozpisze je sam, ${AUTO_EVERY} zagląda tu po nową pracę.`;
// komunikat po dodaniu zadania z doku
export const newTaskText = (bridgeAlive: boolean) => bridgeAlive ? "Mam to. Zadanie jest na kanwie, Claude już zaczyna nad nim pracę: rozpisze kroki i zrobi to, co nie wymaga Twojej zgody." : "Mam to. Zadanie jest na kanwie. Claude rozpisze je na kroki i zrobi to, co nie wymaga Twojej zgody.";
