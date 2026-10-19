// Co czeka na agenta: jedna funkcja dla list_work (tekst dla Claude) i dla mostka na komputerze (same liczby, bez skutków ubocznych).
import * as repo from "@/lib/repo";
import { brief, scoreAll } from "./context";
// list_work pokazuje początek wiadomości; całość (do 50 tys. znaków) jest w get_task
const preview = (x: string, n = 600) => (x.length > n ? x.slice(0, n) + "… (całość w get_task)" : x);

export type WorkCounts = { chat: number; going: number; approved: number; noSteps: number; answered: number; ready: number; approval: number; titles: number };
export const TITLE_RULE = "tytuł zadania: 2–6 słów, samo sedno w słowach Piotra (np. „Zmiany w kroku Employees w onboardingu”), bez „Zmieniłem/Proszę/Chciałbym”, bez zdań i kropek";
export const STEP_TITLE_RULE = "title kroku: od czasownika, 2–6 słów, sedno (np. „Zaktualizuj story Employees”), bez identyfikatorów i nazw plików (te idą do detail)";
export const isLongTitle = (t: string) => t.trim().split(/\s+/).length > 6 || /[.!?]\s+\S/.test(t.trim());
export type WorkSummary = { text: string; counts: WorkCounts; total: number };

// peek: tylko policz, nie oznaczaj odpowiedzi Piotra jako odczytanych (mostek zagląda tu co kilkanaście sekund)
export async function workSummary(ownerId: string, opts: { peek?: boolean } = {}): Promise<WorkSummary> {
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
  const going: string[] = [], approved: string[] = [], ready: string[] = [], approval: string[] = [], held: string[] = [];
  for (const s of free) {
    if (waitingTask.has(s.task.id)) continue;
    for (const st of s.task.steps) {
      const line = `- krok [${st.id}] „${st.title}” (${st.tool}) w zadaniu [${s.task.id}] „${s.task.title}”${st.detail ? ": " + st.detail.slice(0, 200) : ""}`;
      const depsDone = st.dependsOn.every((d) => s.task.steps.find((x) => x.id === d)?.status === "done");
      const isSend = st.blocks?.some((b) => b.type === "draft" && b.status === "approved") || st.prevStatus === "draft";
      // zatwierdzony szkic czeka z wysyłką, aż skończą się kroki przed nim (Piotr może zatwierdzić wcześniej, ale kolejność wysyłki zostaje)
      if (st.status === "handoff" && isSend && !depsDone) { held.push(line); continue; }
      if (st.status === "handoff") { (st.blocks?.some((b) => b.type === "draft" && b.status === "approved") || st.prevStatus === "draft" ? approved : going).push(line + (st.handoffAt ? ` (od ${st.handoffAt})` : "")); continue; }
      if (st.status !== "todo") continue;
      if (!depsDone) continue;
      if (st.tool === "manual") continue;
      if (st.needsApproval) { if (!st.blocks?.some((b) => b.type === "draft")) approval.push(line); } else ready.push(line);
    }
  }
  if (!opts.peek) await Promise.all([repo.markQuestionsSeen(ownerId, answered.map((q) => q.id)), repo.markChatSeen(ownerId, { ids: chat.map((m) => m.id) })]);
  const counts: WorkCounts = { chat: chat.length, going: going.length, approved: approved.length, noSteps: noSteps.length, answered: answered.length, ready: ready.length, approval: approval.length, titles: longTitles.length };
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  const out = [
    chat.length ? "WIADOMOŚCI PIOTRA W ZADANIACH (najpierw to: get_task, potem zrób, o co prosi: gdy zmienia zakres pracy, dodaj kroki przez add_steps z polem before = id kroku publikacji albo wysyłki, przed którym mają wejść; gdy prosi o poprawkę szkicu, popraw go przez set_blocks; gdy pyta, odpowiedz. Wiadomość przy kroku (także odpowiedź na pytanie z kartki) dotyczy kartki tego kroku, dopóki nie jest zrobiony, także kroku Piotra (Ty): gdy zmienia jej treść, zapisz kartkę od nowa przez set_blocks pełnym zestawem klocków (KARTKA KROKU w get_task; pytania z odpowiedziami zostają; bez klocków-notek o zmianie, kartka pokazuje tylko stan) i reply_chat z stepId tego kroku, 1–2 zdania, co zmieniłeś na kartce; gdy nic nie zmienia, reply_chat jednym zdaniem, czemu. Odpowiedź pokazuje się Piotrowi jako dymek czatu nad polem wpisywania. Po każdej załatwionej prośbie reply_chat w tym zadaniu z messageIds = id tej wiadomości: co dopisałeś (numery i tytuły kroków) albo odpowiedź; Piotr widzi wtedy, która prośba jest załatwiona, a która jeszcze w pracy. Nigdy „wezmę pod uwagę” bez kroku):\n" + chat.map((m) => `- zadanie [${m.taskId}] „${m.taskTitle}”${(m.actions as { stepId?: string } | null)?.stepId ? `, przy kroku [${(m.actions as { stepId: string }).stepId}]` : ""}, wiadomość [${m.id}] (${m.createdAt.slice(0, 16).replace("T", " ")} UTC): ${preview(m.text.replace(/\s+/g, " "))}`).join("\n") : "",
    going.length ? "KROKI W TOKU (zaczęte przez Piotra albo poprzedni przebieg; zrób je teraz i zgłoś complete_step, a gdy nie możesz: leave_step z powodem):\n" + going.join("\n") : "",
    approved.length ? "ZATWIERDZONE SZKICE DO WYSŁANIA (wyślij dokładnie treść z sekcji „SZKIC KROKU <id>” w get_task, bez zmian, w formacie z linii „formatowanie” tej sekcji, potem complete_step z linkiem):\n" + approved.join("\n") : "",
    held.length ? "ZATWIERDZONE, ALE CZEKAJĄ NA KROKI PRZED NIMI (nie wysyłaj ich teraz; wyślesz, gdy tamte kroki będą zrobione albo zamknięte jako zbędne):\n" + held.join("\n") : "",
    noSteps.length ? "ZADANIA BEZ KROKÓW (get_task, get_rules z topic „rozpisanie”, gdy tytuł jest długi albo jest całą wiadomością Piotra: update_task z krótkim title (" + TITLE_RULE + "), potem add_steps (" + STEP_TITLE_RULE + ") bez pytań, gdy da się przyjąć rozsądne założenia; w razie potrzeby ask_question):\n" + noSteps.map((s) => brief(s) + (attN[s.task.id] ? ` | załączniki: ${attN[s.task.id]} (get_task, potem get_attachment)` : "")).join("\n") : "",
    answered.length ? "ODPOWIEDZI PIOTRA (kontynuuj pracę w tych zadaniach):\n" + answered.map((q) => `- zadanie [${q.taskId}]${q.stepId ? ` krok [${q.stepId}]` : ""}: pytanie „${q.text}” → odpowiedź: ${q.answer}`).join("\n") : "",
    ready.length ? "KROKI DO ZROBIENIA BEZ ZGODY (start_step, zrób swoimi konektorami, complete_step z linkiem; fakty przez add_facts):\n" + ready.join("\n") : "",
    approval.length ? "KROKI WYMAGAJĄCE ZGODY PIOTRA (przygotuj gotowy szkic przez set_blocks jako blok draft ze status proposed; niczego nie wysyłaj, krok sam przejdzie do zatwierdzenia):\n" + approval.join("\n") : "",
    longTitles.length ? `TYTUŁY DO SKRÓCENIA (update_task z nowym title, nic więcej; ${TITLE_RULE}; pierwotny tytuł zostaje zapisany sam):\n` + longTitles.map((s) => `- zadanie [${s.task.id}] „${s.task.title}”`).join("\n") : "",
    openQ.length ? `ZADANIA CZEKAJĄCE NA ODPOWIEDŹ PIOTRA (pomiń): ${[...waitingTask].map((id) => `[${id}]`).join(", ")}` : "",
  ].filter(Boolean).join("\n\n");
  return { text: out || "Nic nie czeka na agenta.", counts, total };
}
