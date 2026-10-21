// Co czeka na agenta: jedna funkcja dla list_work (tekst dla Claude) i dla mostka na komputerze (same liczby, bez skutków ubocznych).
import * as repo from "@/lib/repo";
import type { Step } from "@/lib/schema";
import { brief, scoreAll } from "./context";
import { approvalValid, draftOf, isPromptDraft, isSendable, type Draft } from "./approval";
// list_work pokazuje początek wiadomości; całość (do 50 tys. znaków) jest w get_task
const preview = (x: string, n = 600) => (x.length > n ? x.slice(0, n) + "… (całość w get_task)" : x);

export type WorkCounts = { chat: number; going: number; approved: number; noSteps: number; answered: number; ready: number; approval: number; titles: number };
export const TITLE_RULE = "tytuł zadania: 2–6 słów, samo sedno w słowach Piotra (np. „Zmiany w kroku Employees w onboardingu”), bez „Zmieniłem/Proszę/Chciałbym”, bez zdań i kropek";
export const STEP_TITLE_RULE = "title kroku: od czasownika, 2–6 słów, sedno (np. „Zaktualizuj story Employees”), bez identyfikatorów i nazw plików (te idą do detail); krok, który coś publikuje, ma w tytule miejsce (np. „Utwórz story podglądu ról w ClickUpie”)";
// praca zrobiona przy rozpisaniu wchodzi jako krok Claude'a od razu zrobiony (add_steps.done); Piotr nie dostaje kroków „Przeczytaj …”: to, co ma wiedzieć, leży na kartce decyzji
export const DONE_RULE = "Pracę, którą już zrobiłeś przy rozpisaniu (przeczytane aplikacje, zebrane dane, raport, analiza), dodaj jako swój krok od razu zrobiony: w add_steps pole done = 1–2 zdania wyniku (tool = aplikacja, z której czytałeś, albo claude; bez needsApproval), a pełny wynik połóż na kartce tego kroku przez set_blocks. Nie twórz Piotrowi kroków „Przeczytaj …” ani „Przejrzyj …”: to, co ma wiedzieć do decyzji, jest na kartce kroku „Zdecyduj …”.";
// szacunek tylko dla kroków Piotra: czas Claude'a liczy się sam od start_step
export const EST_RULE = "est w minutach jako wielokrotność 5 tylko dla kroków Piotra (tool manual; czas kroków Claude'a mierzy się sam)";
// odpowiedź Piotra na kartce jego kroku-decyzji zamyka ten krok sama; agent stosuje decyzję w krokach, które od niego zależą
export const DECISION_MSG = "Wyjątek: wiadomość „Decyzja w kroku …” albo „Zmieniam decyzję w kroku …” to odpowiedź Piotra na kartce jego kroku, który już się przez nią zamknął: jego kartki nie poprawiaj; zastosuj decyzję w krokach, które od niego zależą (kartki i szkice przez set_blocks, nowe kroki przez add_steps, zbędne przez skip_step; przy zmianie decyzji popraw to, co przygotowałeś po poprzedniej odpowiedzi) i odpowiedz reply_chat z messageIds tej wiadomości jednym zdaniem, co zmieniłeś.";
// dokąd ma trafić wynik: jedna rzecz w miejscu docelowym na krok, a gdy miejsce nie wynika z treści i profilu, jedno pytanie na całe zadanie
export const DEST_RULE = "Krok, którego wynik ma trafić do aplikacji (ticket, wiadomość, mail, wydarzenie), ma tool = ta aplikacja (clickup, slack, gmail, calendar…), needsApproval true i miejsce w tytule (np. „Utwórz story podglądu ról w ClickUpie”); szykuje od razu gotową rzecz w miejscu docelowym: jeden ticket, jedna wiadomość albo jedno wydarzenie na krok (kilka story = kilka kroków), bez osobnego kroku „Przygotuj” z tą samą treścią. Gdy z treści, profilu projektu i zasad nie wynika, dokąd ma trafić wynik, zanim dodasz kroki, zadaj jedno ask_question z opcjami (np. „ClickUp (PirxeyOS / Full Backlog)”, „Tylko w Task Hub”) i w tym samym pytaniu zapytaj o wspólne pola (osoba, priorytet, status), raz na całe zadanie.";
// projekt z treści: zadanie bez projektu, którego treść wskazuje projekt z listy, dostaje go przy rozpisaniu; agent nie zakłada nowych projektów
export const PROJECT_RULE = "Projekt: zadanie „bez projektu”, którego treść wskazuje projekt z list_projects (nazwa, także odmieniona, np. „z projektu Shiftwow”, „w Task Hubie”, albo nazwa firmy projektu), dostaje go przy rozpisaniu przez update_task(project = dokładna nazwa z listy); nie twórz nowych projektów i nie zgaduj, gdy treść żadnego nie wskazuje (zostaw bez projektu).";
// lista elementów, o którą prosi Piotr (tickety, wątki, maile jako kroki), to jego otwarte kroki z treścią na kartce, nie zrobione odczyty Claude'a
export const ITEMS_RULE = "Lista elementów: gdy Piotr prosi o elementy jako kroki (tickety, wątki, maile, dokumenty: „każdy X jako osobny krok”, „pokaż ich treść w krokach”), każdy element to jego otwarty krok (tool manual, est 5), title = tytuł elementu w jego języku (bez przerabiania na czasownik), a na kartce przez set_blocks klocek free z treścią elementu 1:1 (Markdown) i klocek link do źródła; takich kroków nie oznaczaj jako zrobione. Jako zrobiony odczyt (add_steps.done) wchodzi tylko praca przygotowawcza (wybór, filtr, analiza), jednym krokiem.";
export const isLongTitle = (t: string) => t.trim().split(/\s+/).length > 6 || /[.!?]\s+\S/.test(t.trim());
export type WorkSummary = { text: string; counts: WorkCounts; total: number };
// kto pyta: bridge-v1 = stara aplikacja mostka (0.1.6, skrypt Node) wysyła zatwierdzone szkice jak dotąd; client = konektor OAuth i automat co godzinę,
// work = bieg pracy mostka v2: oba bez zatwierdzonych szkiców (wysyła je osobny bieg wysyłki); send = bieg wysyłki: tylko jego jeden krok (stepId)
export type WorkAudience = "bridge-v1" | "client" | "work" | "send";
// kto pyta, ten widzi (albo nie) zatwierdzone szkice: stary mostek wysyła z list_work, konektor i bieg pracy nigdy, bieg wysyłki tylko swój krok
export function audienceOf(auth: Pick<repo.TokenAuth, "kind" | "scope">): WorkAudience {
  if (auth.kind === "bridge") return "bridge-v1";
  if (auth.kind === "run") return auth.scope?.kind === "send" ? "send" : "work";
  return "client";
}
export type Sendable = { taskId: string; taskTitle: string; step: Step; draft: Draft; connectionId: string | null };

// szkice do wysłania: ważna zgoda, nikt ich jeszcze nie wziął, kroki przed nimi zrobione; najdawniej zatwierdzony pierwszy.
// Zatwierdzony prompt (Claude Code, Claude) to nie wysyłka: wykonuje go bieg pracy (KROKI W TOKU)
export async function listSendable(ownerId: string): Promise<Sendable[]> {
  const [tasks, openQ] = await Promise.all([repo.listTasks(ownerId), repo.listQuestions(ownerId, { open: true })]);
  const unfinished = new Set(tasks.filter((t) => !t.doneAt && !t.deletedAt).map((t) => t.id));
  const waiting = new Set(openQ.map((q) => q.taskId));
  const out: Sendable[] = [];
  for (const t of tasks) {
    if (t.doneAt || t.deletedAt || waiting.has(t.id) || t.dependsOn.some((d) => unfinished.has(d))) continue;
    for (const st of t.steps) {
      const d = draftOf(st);
      if (d && isSendable(st) && !isPromptDraft(d, st.blocks) && st.dependsOn.every((x) => t.steps.find((y) => y.id === x)?.status === "done")) out.push({ taskId: t.id, taskTitle: t.title, step: st, draft: d, connectionId: st.connectionId });
    }
  }
  return out.sort((a, b) => (a.step.approvedAt ?? "").localeCompare(b.step.approvedAt ?? ""));
}

// lista pracy dla biegu wysyłki: tylko ten jeden szkic, i tylko gdy bieg go wziął (send_started_at), a zgoda wciąż jest ważna
async function sendSummary(ownerId: string, stepId: string | undefined): Promise<WorkSummary> {
  const tasks = stepId ? await repo.listTasks(ownerId) : [];
  const t = tasks.find((x) => x.steps.some((s) => s.id === stepId));
  const st = t?.steps.find((s) => s.id === stepId);
  const counts: WorkCounts = { chat: 0, going: 0, approved: 0, noSteps: 0, answered: 0, ready: 0, approval: 0, titles: 0 };
  if (!t || !st || !approvalValid(st) || !st.sendStartedAt) return { text: "Nic nie czeka na agenta.", counts, total: 0 };
  counts.approved = 1;
  return { text: `SZKIC DO WYSŁANIA W TYM BIEGU (get_task tego zadania, wyślij dokładnie treść z sekcji „SZKIC KROKU ${st.id}”, bez zmian, tam, gdzie wskazuje „dokąd”, w formacie z linii „formatowanie”, raz; potem complete_step z linkiem; przy jakiejkolwiek wątpliwości leave_step z powodem i nic nie wysyłaj):\n- krok [${st.id}] „${st.title}” (${st.tool}) w zadaniu [${t.id}] „${t.title}”`, counts, total: 1 };
}

// peek: tylko policz, nie oznaczaj odpowiedzi Piotra jako odczytanych (mostek zagląda tu co kilkanaście sekund)
export async function workSummary(ownerId: string, opts: { peek?: boolean; audience?: WorkAudience; stepId?: string } = {}): Promise<WorkSummary> {
  const audience = opts.audience ?? "bridge-v1";
  if (audience === "send") return sendSummary(ownerId, opts.stepId);
  const sends = audience === "bridge-v1";   // tylko stary mostek wysyła z listy pracy; reszta nie widzi zatwierdzonych szkiców
  const [tasks, projects, samples, answered, chat] = await Promise.all([repo.listTasks(ownerId), repo.listProjects(ownerId), repo.listSamples(ownerId), repo.listQuestions(ownerId, { answeredUnseen: true }), repo.listUnseenChat(ownerId)]);
  const open = scoreAll(tasks, projects, samples).filter((s) => !s.task.doneAt && !s.task.deletedAt);
  const unfinished = new Set(tasks.filter((t) => !t.doneAt && !t.deletedAt).map((t) => t.id));
  const free = open.filter((s) => !s.task.dependsOn.some((d) => unfinished.has(d)));   // zadania, które nie czekają na inne zadania
  const openQ = await repo.listQuestions(ownerId, { open: true });
  const waitingTask = new Set(openQ.map((q) => q.taskId));
  const noSteps = free.filter((s) => !s.task.steps.length && !waitingTask.has(s.task.id));
  const attN = await repo.countAttachments(noSteps.map((s) => s.task.id));
  // tytuły zadań wpisane jako cała wiadomość Piotra (dłuższe niż 6 słów albo zdanie z kropką), których agent jeszcze nie skrócił
  const longTitles = open.filter((s) => !s.task.titleOriginal && isLongTitle(s.task.title));
  const going: string[] = [], approved: string[] = [], ready: string[] = [], approval: string[] = [], held: string[] = [], files: string[] = [];
  for (const s of free) {
    if (waitingTask.has(s.task.id)) continue;
    for (const st of s.task.steps) {
      const line = `- krok [${st.id}] „${st.title}” (${st.tool}) w zadaniu [${s.task.id}] „${s.task.title}”${st.detail ? ": " + st.detail.slice(0, 200) : ""}`;
      const depsDone = st.dependsOn.every((d) => s.task.steps.find((x) => x.id === d)?.status === "done");
      // szkic ze zgodą Piotra (podpis treści): wysyła go stary mostek z tej listy albo osobny bieg wysyłki; zgoda nieważna albo wysyłka w toku = nic dla agenta
      if (st.status === "handoff" && (st.approvedAt || st.sendStartedAt || draftOf(st)?.status === "approved")) {
        // zatwierdzony prompt dla agenta: bieg pracy (i klient) wykonuje go jak krok w toku; stary mostek ma go w szkicach do wysłania
        if (!sends && depsDone && isSendable(st) && isPromptDraft(draftOf(st), st.blocks)) { going.push(line + " (zatwierdzony prompt: wykonaj polecenie z sekcji „SZKIC KROKU” w get_task, potem complete_step)"); continue; }
        if (!sends || !isSendable(st)) continue;
        // zatwierdzony szkic czeka z wysyłką, aż skończą się kroki przed nim (Piotr może zatwierdzić wcześniej, ale kolejność wysyłki zostaje)
        (depsDone ? approved : held).push(line + (depsDone && st.handoffAt ? ` (od ${st.handoffAt})` : ""));
        continue;
      }
      // plik na Macu zapisuje tylko bieg pracy mostka (aplikacja 0.1.7): inni go nie widzą
      if (st.tool === "file" && audience !== "work") continue;
      if (st.status === "handoff") { going.push(line + (st.handoffAt ? ` (od ${st.handoffAt})` : "") + (st.tool === "file" ? " (plik na Macu: dokończ jak w sekcji PLIKI NA MACU)" : "")); continue; }
      if (st.status !== "todo") continue;
      if (!depsDone) continue;
      if (st.tool === "manual") continue;
      if (st.tool === "file") { files.push(line); continue; }
      // szkic nieaktualny (nowe kroki weszły przed nim) agent przygotowuje od nowa, gdy kroki przed nim są zrobione
      if (st.needsApproval) { if (!st.blocks?.some((b) => b.type === "draft" && !b.stale)) approval.push(line); } else ready.push(line);
    }
  }
  if (!opts.peek) await Promise.all([repo.markQuestionsSeen(ownerId, answered.map((q) => q.id)), repo.markChatSeen(ownerId, { ids: chat.map((m) => m.id) })]);
  const counts: WorkCounts = { chat: chat.length, going: going.length, approved: approved.length, noSteps: noSteps.length, answered: answered.length, ready: ready.length + files.length, approval: approval.length, titles: longTitles.length };
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  const out = [
    chat.length ? "WIADOMOŚCI PIOTRA W ZADANIACH (najpierw to: get_task, potem zrób, o co prosi: gdy zmienia zakres pracy, dodaj kroki przez add_steps z polem before = id kroku publikacji albo wysyłki, przed którym mają wejść; gdy prosi o poprawkę szkicu, popraw go przez set_blocks; gdy pyta, odpowiedz. Wiadomość przy kroku (także odpowiedź na pytanie z kartki) dotyczy kartki tego kroku, dopóki nie jest zrobiony, także kroku Piotra (Ty): gdy zmienia jej treść, zapisz kartkę od nowa przez set_blocks pełnym zestawem klocków (KARTKA KROKU w get_task; pytania z odpowiedziami zostają; bez klocków-notek o zmianie, kartka pokazuje tylko stan) i reply_chat z stepId tego kroku, 1–2 zdania, co zmieniłeś na kartce; gdy nic nie zmienia, reply_chat jednym zdaniem, czemu. " + DECISION_MSG + " Odpowiedź pokazuje się Piotrowi jako dymek czatu nad polem wpisywania. Po każdej załatwionej prośbie reply_chat w tym zadaniu z messageIds = id tej wiadomości: co dopisałeś (numery i tytuły kroków) albo odpowiedź; Piotr widzi wtedy, która prośba jest załatwiona, a która jeszcze w pracy. Nigdy „wezmę pod uwagę” bez kroku):\n" + chat.map((m) => `- zadanie [${m.taskId}] „${m.taskTitle}”${(m.actions as { stepId?: string } | null)?.stepId ? `, przy kroku [${(m.actions as { stepId: string }).stepId}]` : ""}, wiadomość [${m.id}] (${m.createdAt.slice(0, 16).replace("T", " ")} UTC): ${preview(m.text.replace(/\s+/g, " "))}`).join("\n") : "",
    going.length ? "KROKI W TOKU (zaczęte przez Piotra albo poprzedni przebieg; zrób je teraz i zgłoś complete_step, a gdy nie możesz: leave_step z powodem):\n" + going.join("\n") : "",
    approved.length ? "ZATWIERDZONE SZKICE DO WYSŁANIA (wyślij dokładnie treść z sekcji „SZKIC KROKU <id>” w get_task, bez zmian, w formacie z linii „formatowanie” tej sekcji, potem complete_step z linkiem):\n" + approved.join("\n") : "",
    held.length ? "ZATWIERDZONE, ALE CZEKAJĄ NA KROKI PRZED NIMI (nie wysyłaj ich teraz; wyślesz, gdy tamte kroki będą zrobione albo zamknięte jako zbędne):\n" + held.join("\n") : "",
    noSteps.length ? "ZADANIA BEZ KROKÓW (get_task, get_rules z topic „rozpisanie”, gdy tytuł jest długi albo jest całą wiadomością Piotra: update_task z krótkim title (" + TITLE_RULE + "), potem add_steps (" + STEP_TITLE_RULE + ") bez pytań, gdy da się przyjąć rozsądne założenia; w razie potrzeby ask_question. " + PROJECT_RULE + " " + ITEMS_RULE + " " + DEST_RULE + " " + DONE_RULE + " " + EST_RULE + "):\n" + noSteps.map((s) => brief(s) + (attN[s.task.id] ? ` | załączniki: ${attN[s.task.id]} (get_task, potem get_attachment)` : "")).join("\n") : "",
    answered.length ? "ODPOWIEDZI PIOTRA (kontynuuj pracę w tych zadaniach):\n" + answered.map((q) => `- zadanie [${q.taskId}]${q.stepId ? ` krok [${q.stepId}]` : ""}: pytanie „${q.text}” → odpowiedź: ${q.answer}`).join("\n") : "",
    // bez starego mostka: konektor i bieg pracy tylko czytają; zmiana w aplikacji zewnętrznej to zawsze szkic (krok bez zgody mógł dodać agent)
    ready.length ? (sends ? "KROKI DO ZROBIENIA BEZ ZGODY (start_step, zrób swoimi konektorami, complete_step z linkiem; fakty przez add_facts):\n"
      : "KROKI DO ZROBIENIA BEZ ZGODY (tylko czytanie i analiza: start_step, czytaj swoimi konektorami, complete_step z linkiem; fakty przez add_facts. Gdy krok ma coś wysłać albo zmienić w aplikacji zewnętrznej (wiadomość, komentarz, ticket, wydarzenie, plik w Dysku Google), nie rób tego, nawet jeśli krok nie wymaga zgody: przygotuj szkic przez set_blocks jako blok draft ze status proposed; po zatwierdzeniu przez Piotra wyśle go mostek Task Hub):\n") + ready.join("\n") : "",
    files.length ? "PLIKI NA MACU (start_step → zapisz nowy plik narzędziem Write w folderze z linii „Foldery na pliki” na końcu polecenia → tę samą treść pokaż na kartce przez set_blocks jako klocek free → complete_step z polem file = pełna ścieżka; gdy folderu nie ma na liście: leave_step z powodem „Dodaj folder <ścieżka> w Ustawieniach aplikacji Task Hub na Macu (Foldery na pliki)”):\n" + files.join("\n") : "",
    approval.length ? "KROKI WYMAGAJĄCE ZGODY PIOTRA (przygotuj gotowy szkic przez set_blocks jako blok draft ze status proposed; niczego nie wysyłaj, krok sam przejdzie do zatwierdzenia):\n" + approval.join("\n") : "",
    longTitles.length ? `TYTUŁY DO SKRÓCENIA (update_task z nowym title, nic więcej; ${TITLE_RULE}; pierwotny tytuł zostaje zapisany sam):\n` + longTitles.map((s) => `- zadanie [${s.task.id}] „${s.task.title}”`).join("\n") : "",
    openQ.length ? `ZADANIA CZEKAJĄCE NA ODPOWIEDŹ PIOTRA (pomiń): ${[...waitingTask].map((id) => `[${id}]`).join(", ")}` : "",
  ].filter(Boolean).join("\n\n");
  return { text: out || "Nic nie czeka na agenta.", counts, total };
}
