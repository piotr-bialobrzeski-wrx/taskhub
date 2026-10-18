// Co czeka na agenta: jedna funkcja dla list_work (tekst dla Claude) i dla mostka na komputerze (same liczby, bez skutków ubocznych).
import * as repo from "@/lib/repo";
import { brief, scoreAll } from "./context";
// list_work pokazuje początek wiadomości; całość (do 50 tys. znaków) jest w get_task
const preview = (x: string, n = 600) => (x.length > n ? x.slice(0, n) + "… (całość w get_task)" : x);

export type WorkCounts = { chat: number; going: number; approved: number; noSteps: number; answered: number; ready: number; approval: number };
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
  const going: string[] = [], approved: string[] = [], ready: string[] = [], approval: string[] = [];
  for (const s of free) {
    if (waitingTask.has(s.task.id)) continue;
    for (const st of s.task.steps) {
      const line = `- krok [${st.id}] „${st.title}” (${st.tool}) w zadaniu [${s.task.id}] „${s.task.title}”${st.detail ? ": " + st.detail.slice(0, 200) : ""}`;
      if (st.status === "handoff") { (st.blocks?.some((b) => b.type === "draft" && b.status === "approved") || st.prevStatus === "draft" ? approved : going).push(line + (st.handoffAt ? ` (od ${st.handoffAt})` : "")); continue; }
      if (st.status !== "todo") continue;
      if (!st.dependsOn.every((d) => s.task.steps.find((x) => x.id === d)?.status === "done")) continue;
      if (st.tool === "manual") continue;
      if (st.needsApproval) { if (!st.blocks?.some((b) => b.type === "draft")) approval.push(line); } else ready.push(line);
    }
  }
  if (!opts.peek) await Promise.all([repo.markQuestionsSeen(ownerId, answered.map((q) => q.id)), repo.markChatSeen(ownerId, { ids: chat.map((m) => m.id) })]);
  const counts: WorkCounts = { chat: chat.length, going: going.length, approved: approved.length, noSteps: noSteps.length, answered: answered.length, ready: ready.length, approval: approval.length };
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  const out = [
    chat.length ? "WIADOMOŚCI PIOTRA W ZADANIACH (najpierw to: get_task, potem zrób, o co prosi: gdy zmienia zakres pracy, dodaj kroki przez add_steps z polem before = id kroku publikacji albo wysyłki, przed którym mają wejść; gdy prosi o poprawkę szkicu, popraw go przez set_blocks; gdy pyta, odpowiedz. Zawsze zakończ reply_chat w tym zadaniu: co dopisałeś (numery i tytuły kroków) albo odpowiedź. Nigdy „wezmę pod uwagę” bez kroku):\n" + chat.map((m) => `- zadanie [${m.taskId}] „${m.taskTitle}” (${m.createdAt.slice(0, 16).replace("T", " ")} UTC): ${preview(m.text.replace(/\s+/g, " "))}`).join("\n") : "",
    going.length ? "KROKI W TOKU (zaczęte przez Piotra albo poprzedni przebieg; zrób je teraz i zgłoś complete_step, a gdy nie możesz: leave_step z powodem):\n" + going.join("\n") : "",
    approved.length ? "ZATWIERDZONE SZKICE DO WYSŁANIA (wyślij dokładnie treść z bloku draft w get_task, bez zmian, potem complete_step z linkiem):\n" + approved.join("\n") : "",
    noSteps.length ? "ZADANIA BEZ KROKÓW (get_task, get_rules z topic „rozpisanie”, potem add_steps bez pytań, gdy da się przyjąć rozsądne założenia; w razie potrzeby ask_question):\n" + noSteps.map((s) => brief(s) + (attN[s.task.id] ? ` | załączniki: ${attN[s.task.id]} (get_task, potem get_attachment)` : "")).join("\n") : "",
    answered.length ? "ODPOWIEDZI PIOTRA (kontynuuj pracę w tych zadaniach):\n" + answered.map((q) => `- zadanie [${q.taskId}]${q.stepId ? ` krok [${q.stepId}]` : ""}: pytanie „${q.text}” → odpowiedź: ${q.answer}`).join("\n") : "",
    ready.length ? "KROKI DO ZROBIENIA BEZ ZGODY (start_step, zrób swoimi konektorami, complete_step z linkiem; fakty przez add_facts):\n" + ready.join("\n") : "",
    approval.length ? "KROKI WYMAGAJĄCE ZGODY PIOTRA (przygotuj gotowy szkic przez set_blocks jako blok draft ze status proposed; niczego nie wysyłaj, krok sam przejdzie do zatwierdzenia):\n" + approval.join("\n") : "",
    openQ.length ? `ZADANIA CZEKAJĄCE NA ODPOWIEDŹ PIOTRA (pomiń): ${[...waitingTask].map((id) => `[${id}]`).join(", ")}` : "",
  ].filter(Boolean).join("\n\n");
  return { text: out || "Nic nie czeka na agenta.", counts, total };
}
