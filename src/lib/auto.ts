// Automat: Claude z subskrypcji Piotra (zadanie zaplanowane na jego koncie Claude) zagląda do Task Hub przez konektor i robi, co czeka (list_work).
// Aplikacja nie uruchamia go sama (bez klucza API nie ma jak); mówi tylko, czego się spodziewać.
export const AUTO_EVERY = "co godzinę";
export const AUTO_TEXT = `Claude zagląda tu ${AUTO_EVERY}: rozpisuje nowe zadania na kroki, robi analizy, research i szkice, a na zewnątrz wysyła tylko to, co zatwierdzisz. Włączasz i wyłączasz to w aplikacji Claude, w zadaniach zaplanowanych.`;
