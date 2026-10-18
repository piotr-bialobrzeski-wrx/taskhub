// Mostek na komputerze (wzorzec z Project Hub): program na Macu odpytuje Task Hub tanim HTTP bez tokenów,
// a Claude Code rusza tylko wtedy, gdy czeka praca. Tu: autoryzacja tokenem rodzaju "bridge", okna czasowe i prompt dla biegu.
import * as repo from "./repo";
import { appUrl } from "./session";

export const BRIDGE_ALIVE_MS = 120_000;   // puls starszy niż 2 min = mostek nieaktywny (odpytuje co 15–60 s)
export const RUN_STALE_MIN = 15;          // bieg bez sygnału przez 15 min wygasa i zwalnia miejsce
export const RUN_MAX_MIN = 45;            // najdłuższy bieg Claude Code
export const BRIDGE_VERSION = 1;
export const APP_DOWNLOAD_URL = "https://github.com/piotr-bialobrzeski-wrx/taskhub/releases/latest";   // aplikacja Task Hub na Maca (instalator .pkg)

export type BridgeAuth = { ownerId: string; tokenId: string; name: string };
export async function authBridge(req: Request): Promise<BridgeAuth | Response> {
  const m = /^Bearer\s+(.+)$/i.exec(req.headers.get("authorization") ?? "");
  const t = m ? await repo.tokenForSecret(m[1].trim()) : null;
  if (!t || t.kind !== "bridge") return Response.json({ error: "Potrzebny token mostka: Ustawienia → Agent → Mostek na komputerze." }, { status: 401 });
  return { ownerId: t.ownerId, tokenId: t.id, name: t.name };
}

// godzina w Warszawie: w dzień mostek pyta co 15 s, w nocy co minutę (mniej wywołań, i tak nikt nie dodaje zadań)
export function warsawHour(now = new Date()): number {
  return Number(new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Warsaw", hour: "numeric", hour12: false }).format(now)) % 24;
}
export const pollMs = (now = new Date()) => (warsawHour(now) >= 7 && warsawHour(now) < 23 ? 15_000 : 60_000);

export const ago = (iso: string | null, now = Date.now()): string => {
  if (!iso) return "nigdy";
  const s = Math.max(0, Math.round((now - new Date(iso).getTime()) / 1000));
  return s < 60 ? `${s} s temu` : s < 3600 ? `${Math.round(s / 60)} min temu` : `${Math.round(s / 3600)} godz. temu`;
};

// Prompt jednego biegu. Serwer go podaje, więc zmiany trafiają na komputer bez ruszania mostka.
export function bridgePrompt(): string {
  return [
    `Jesteś automatem aplikacji Task Hub (zadania Piotra), uruchomionym w tle na jego komputerze przez mostek. Pracujesz przez konektor Task Hub (narzędzia mcp__task-hub__*) i inne konektory, które masz w Claude Code na tym komputerze. Nikt nie czyta tej sesji, więc nie zadawaj pytań w konsoli; pytania do Piotra wyłącznie przez ask_question (odpowie w Task Hub). Zrób jeden przebieg i zakończ.`,
    `1. Wywołaj list_work. Jeśli odpowiedź to „Nic nie czeka na agenta”, odpowiedz „Nic do zrobienia.” i zakończ bez innych wywołań.`,
    `2. Rób sekcje w kolejności, w jakiej je wypisano. Przed pracą nad zadaniem wywołaj get_task (pełny kontekst) i get_rules z polami tools (narzędzia kroku) i topic (tematy pracy, np. "rozpisanie", "story", "bug", "przegląd") i stosuj to, co dostaniesz: profil, zasady i pasujące procedury. Gdy w spisie procedur jest coś, co pasuje do kroku, pobierz pełną treść przez get_rules z topic z jej nazwą.
   - Gdy krok ma pole „połączenie”, rób go tym konektorem (tym kontem). Gdy nie ma, a masz kilka kont tej samej aplikacji, wybierz to z firmy zadania (list_connections pokazuje firmę i sferę każdego połączenia). Nigdy nie wysyłaj z konta innej firmy ani z prywatnego do zadania zawodowego.
   - WIADOMOŚCI PIOTRA W ZADANIACH: to ma pierwszeństwo. get_task (rozmowa w zadaniu jest na końcu kontekstu), potem zrób, o co Piotr prosi: gdy prośba zmienia zakres pracy (nowe wymagania, dodatkowe rzeczy do zrobienia), dodaj kroki przez add_steps z polem before = id kroku, przed którym mają wejść (zwykle krok publikacji, wysyłki, commitu; bez before, gdy takiego kroku nie ma); gdy prosi o poprawkę szkicu, popraw go przez set_blocks; gdy pyta, odpowiedz. Na końcu zawsze reply_chat w tym zadaniu, 1–3 zdania: co dopisałeś (numery i tytuły kroków) albo odpowiedź. Nigdy nie odpowiadaj „wezmę to pod uwagę” bez dodania kroku.
   - KROKI W TOKU: dokończ je (start_step już był), zgłoś complete_step z krótkim podsumowaniem i linkiem do wyniku. Gdy nie da się ich zrobić: leave_step z powodem.
   - ZATWIERDZONE SZKICE DO WYSŁANIA: wyślij dokładnie treść z bloku draft (bez zmian) tam, gdzie wskazuje target, potem complete_step z linkiem.
   - ZADANIA BEZ KROKÓW: najpierw get_task tego zadania (od tej chwili Piotr widzi na kafelku, że rozpisujesz), potem od razu add_steps (2–7 kroków: title od czasownika, tool, detail z przyjętymi założeniami, est w minutach jako wielokrotność 15, needsApproval true dla każdego kroku, który wysyła albo zapisuje coś w zewnętrznej aplikacji widocznej dla innych, dependsOn jako n1, n2). Nie pytaj o zgodę na rozpisanie; przyjmuj rozsądne założenia. Gdy w treści jest termin: update_task(due). Potem w tym samym przebiegu bierz się za kroki tego zadania, które są gotowe.
   - KROKI DO ZROBIENIA BEZ ZGODY (analiza, research, czytanie maili, wątków, ticketów, kalendarza, przygotowanie materiałów): start_step → zrób pracę swoimi konektorami → add_facts (istotne informacje z pochodzeniem) → complete_step z podsumowaniem i linkiem.
   - KROKI WYMAGAJĄCE ZGODY: przygotuj kompletny szkic (treść gotowa do wysłania, w języku z zasad) i zapisz go przez set_blocks: najpierw klocki kontekstu, na których szkic się opiera (thread z wątkiem Slacka jako dymki, mail z wątkiem maili, comment, facts, table, media ze zrzutami; każdy z source {app, ref, url}), potem blok draft ze status "proposed" (target.app, target.where, action, body, ewentualnie subject; wiersze arkusza jako columns + rows). Piotr musi widzieć, na podstawie czego powstał szkic. Niczego nie wysyłaj; krok sam przejdzie do zatwierdzenia u Piotra.
   - Krok, którego nie masz jak zrobić (brak narzędzia, dostępu albo danych): leave_step z krótkim powodem. Krok z tool manual zostaw Piotrowi.
   - KROK Z KODEM (tool code, Claude Code): pracuj w repozytorium z profilu projektu, na gałęzi roboczej. Zanim zgłosisz complete_step, zapisz przez set_blocks blok changes (repo, branch, preview = adres podglądu http albo file://ścieżka do pliku, który Piotr otworzy, files = każdy zmieniony plik z krótkim note i diffem) oraz, gdy krok wymaga zgody, blok draft z target.app "github", action "commit" albo "push", where = repozytorium i gałąź, body = treść commita; w add_facts zapisz, jak sprawdziłeś zmiany (test, build, zrzut). Commit i push tylko po zatwierdzeniu szkicu przez Piotra (sekcja ZATWIERDZONE SZKICE).
   - Każde użycie narzędzia Piotr widzi na żywo na kafelku zadania, więc nie raportuj postępu w rozmowie; rozmowa jest na odpowiedzi i decyzje.
   - KRÓTKO: summary w complete_step to 1–2 zdania o efekcie (Piotr czyta je w sekcji „Teraz” karty kroku; w rozmowie widzi tylko „Gotowe: tytuł kroku”). Gdy krok ma blok changes albo szkic, nie powtarzaj ich treści: summary mówi tylko to, czego tam nie ma (założenia, zastrzeżenia, co pominięto), a każde założenie to osobna linia od słów „Do potwierdzenia: …”. Pliki, adresy, liczby i sposób sprawdzenia idą do add_facts albo do bloku changes, nie do podsumowania ani do rozmowy. reply_chat: 1–3 zdania.`,
    `3. Twarde zasady: niczego nie usuwaj w żadnej aplikacji ani na dysku; nie wysyłaj wiadomości, komentarzy, zaproszeń ani nie twórz elementów widocznych dla innych osób bez zatwierdzonego szkicu (nawet jeśli krok nie ma needsApproval: wtedy przygotuj szkic przez set_blocks zamiast wysyłać); czytanie i analiza w zewnętrznych aplikacjach są zawsze dozwolone; nie zmieniaj kroków ani zadań, których Piotr nie prosił zmieniać, poza polami opisanymi wyżej; nie instaluj niczego i nie zmieniaj plików poza katalogiem roboczym.`,
    `4. Na końcu odpowiedz 1–3 zdaniami: co rozpisałeś, co zrobiłeś, jakie szkice czekają na zgodę, co oddałeś i dlaczego.`,
  ].join("\n\n");
}

export const mcpUrl = () => appUrl() + "/api/mcp";
