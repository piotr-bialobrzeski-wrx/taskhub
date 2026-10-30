// Wiadomość z głównego pola: dok na kanwie i w zadaniu (akcja chat) oraz szybki pasek w aplikacji na Macu (/api/bridge/task).
// Jedna droga, więc pasek daje dokładnie to samo co dok: zadanie z tekstu, pliki w zadaniu, wpis w rozmowie i odpowiedź „kto się tym zajmie”.
import * as repo from "./repo";
import { aiFor } from "./services";
import { runChat } from "./agent/chat";
import { bridgeHold, busyWith, commandWho, newTaskText, noStepsWho, type Worker } from "./auto";
import { liveActivity } from "./live";
import { BRIDGE_ALIVE_MS } from "./bridge";

export const MAX_UPLOAD = 4 * 1024 * 1024;   // limit treści żądania na Vercelu
const IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]);
const fail = (e: unknown) => (e instanceof Error ? e.message : String(e));

// pliki z doku (z dysku, Ctrl+V, przeciągnięte) albo z paska: do 8 sztuk, każdy do 4 MB
export function uploads(fd: FormData): File[] {
  return fd.getAll("files").filter((f): f is File => typeof f === "object" && f !== null && "arrayBuffer" in f && (f as File).size > 0 && (f as File).size <= MAX_UPLOAD).slice(0, 8);
}
async function attachFiles(taskId: string, files: File[], notes: { caption: string; analysis: string }[] = []) {
  for (const [i, f] of files.entries()) {
    const data = Buffer.from(await f.arrayBuffer());
    // obrazkiem jest tylko to, co /api/files pokazuje w przeglądarce (SVG i reszta idą jako plik do pobrania)
    await repo.addAttachment({ taskId }, { kind: IMAGE_TYPES.has(f.type) && !/\.svg$/i.test(f.name) ? "image" : "file", name: f.name, mime: f.type || undefined, bytes: f.size, keep: true, data, caption: notes[i]?.caption, analysis: notes[i]?.analysis });
  }
}

// goTo: nowe zadanie z tej wiadomości (dok przechodzi do niego, pasek otwiera je z historii); note: odpowiedź dopisana do rozmowy
export async function intake(ownerId: string, m: { typed: string; files: File[]; taskId: string | null; stepId: string | null }): Promise<{ goTo: string | null; note: string | null }> {
  const { typed, files, taskId, stepId } = m;
  if (!typed && !files.length) return { goTo: null, note: null };
  const text = typed || (files.length === 1 ? `Załącznik: ${files[0].name}` : `Załączniki: ${files.map((f) => f.name).join(", ")}`);
  const ai = await aiFor(ownerId);
  if (!ai.enabled) {
    // bez klucza modelu: w zadaniu wiadomość czeka na agenta; na kanwie sam tekst czeka na agenta jako polecenie (paczka 29),
    // a tekst z plikami staje się zadaniem od razu (wpis w rozmowie kanwy jest wtedy tylko historią, załatwiony)
    const toTask = !taskId && files.length > 0;
    await repo.addChat(ownerId, taskId, "user", text + (typed && files.length ? ` (załączniki: ${files.map((f) => f.name).join(", ")})` : ""), stepId ? { stepId } : undefined, { seen: toTask });
    // komunikaty mówią, co z tego ma Piotr, nie jak działa mechanizm
    // w zadaniu wiadomość czeka w kolejce: jej stan (kto ją weźmie i kiedy, w pracy, odpowiedziano) liczy się na bieżąco pod dymkiem i na karcie nad dokiem,
    // bez dopisywania do rozmowy zapowiedzi „przeczyta za chwilę” przy każdej wiadomości
    if (taskId) { await attachFiles(taskId, files); return { goTo: null, note: null }; }
    // paczka 29: tekst z kanwy (albo paska) bez plików nie staje się od razu zadaniem. Czeka na agenta jako polecenie: „pogrupuj kafelki”,
    // „znajdź…”, „otwórz krok…” agent robi od razu i odpowiada w dymku; nowe zadanie zakłada tylko, gdy Piotr opisuje nową pracę
    // (rozróżnienie w zasadzie z bazy). Pliki potrzebują zadania, więc wiadomość z plikami dalej zakłada je od razu
    if (!toTask) {
      const st = await repo.bridgeStatus(ownerId, BRIDGE_ALIVE_MS);
      return { goTo: null, note: commandWho({ alive: st.alive, name: st.name, run: liveActivity(st.run), hold: bridgeHold(st.meta, st.pause) }) };
    }
    // nowe zadanie z kanwy: kto je rozpisze i kiedy (mostek teraz / po bieżącej pracy / w ciągu minuty, albo automat o pełnej godzinie)
    const t = await repo.createTask(ownerId, { title: text.slice(0, 120), source: typed }); await attachFiles(t.id, files);
    const [st, tasks] = await Promise.all([repo.bridgeStatus(ownerId, BRIDGE_ALIVE_MS), repo.listTasks(ownerId)]);
    const w: Worker = { alive: st.alive, name: st.name, run: liveActivity(st.run), hold: bridgeHold(st.meta, st.pause) };
    const note = newTaskText(t.title, noStepsWho(w, t.id, busyWith(w.run, tasks)));
    await repo.addChat(ownerId, null, "agent", note);
    return { goTo: t.id, note };
  }
  try {
    const images = await Promise.all(files.filter((f) => IMAGE_TYPES.has(f.type)).map(async (f) => ({ mediaType: f.type as "image/png", base64: Buffer.from(await f.arrayBuffer()).toString("base64") })));
    const { done, result } = await runChat(text, { ai, ownerId, taskId, stepId, images });
    const created = done.find((d) => d.taskId && d.label.startsWith("Nowe zadanie"));
    const target = taskId ?? created?.taskId ?? null;
    if (target) await attachFiles(target, files, result.attachments ?? []);
    return { goTo: !taskId && created?.taskId ? created.taskId : null, note: null };
  } catch (e) {
    await repo.addChat(ownerId, taskId, "user", text);
    const note = "Agent nie odpowiedział: " + fail(e);
    await repo.addChat(ownerId, taskId, "agent", note);
    return { goTo: null, note };
  }
}
