// Paczka 18: kolejka agenta. Kolejność ustawiona przez Piotra w panelu w rogu wygrywa z kolejnością, w jakiej agent sam bierze pracę:
// lista pracy daje te pozycje na początek (sekcja NAJPIERW), a bieg mostka bierze model pierwszej z nich. „Wycofaj” zabiera wiadomość z kolejki.
import { describe, it, expect, beforeAll, vi } from "vitest";
import { orderQueue } from "@/lib/agent/work";
import { workBubble } from "@/lib/feed";

vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));
vi.mock("@/lib/session", async (orig) => ({ ...(await orig<typeof import("@/lib/session")>()), requireOwner: async () => (await import("@/lib/repo")).ensureOwner() }));

describe("kolejność kolejki", () => {
  const it3 = [{ key: "a", rank: 0 }, { key: "b", rank: 3 }, { key: "c", rank: 5 }, { key: "d", rank: 5 }];
  it("bez ustawień: tak, jak bierze agent (sekcje po kolei, w sekcji kolejność listy)", () => {
    expect(orderQueue(it3, []).map((x) => x.key)).toEqual(["a", "b", "c", "d"]);
  });
  it("ustawione pozycje idą na początek w kolejności Piotra, reszta za nimi; klucze, których już nie ma, nic nie psują", () => {
    expect(orderQueue(it3, ["d", "zniknęła", "b"]).map((x) => x.key)).toEqual(["d", "b", "a", "c"]);
  });
});

describe("dymek wiadomości w kolejce", () => {
  const task = { id: "t1", steps: [] };
  const pending = [{ id: "m1", role: "user" as const, text: "dodaj krok z testem grup", createdAt: "2026-10-25T17:00:00Z", seenAt: null, answeredAt: null, actions: null, taskId: "t1" }];
  const run = { text: "czyta zadanie", detail: null, since: "2026-10-25T16:50:00Z", stepId: "s9", taskId: "t9", bridge: "Mac", runId: "r1", kind: "work" as const };
  const queue = { now: { taskId: "t9", taskTitle: "Dobór modelu", label: "Krok 07: Sprawdź limity", since: run.since, what: "czyta zadanie", runId: "r1", stoppable: true }, items: [
    { key: "step:x", kind: "krok do zrobienia", taskId: "t2", taskTitle: "Duplikaty", stepId: "x", label: "Krok 03" },
    { key: "chat:t1", kind: "odpowiedź na Twoją wiadomość", taskId: "t1", taskTitle: "Grupy", stepId: null, label: "Twoja wiadomość" },
  ] };
  it("Claude pracuje gdzie indziej: „W kolejce: 2. z 2”, kto teraz pracuje i klucz do „Następne”", () => {
    const b = workBubble({ task, w: { alive: true, name: "Mac", run }, pending: pending as never, busy: "Sprawdź limity", queue });
    expect(b).toMatchObject({ kind: "sent", title: "W kolejce: 2. z 2", line: "Claude kończy zadanie „Dobór modelu”", queue: { pos: 2, of: 2, key: "chat:t1", nowTask: { id: "t9", title: "Dobór modelu" } } });
  });
  it("Claude pracuje w tym zadaniu: dymek pracy, nie kolejki", () => {
    const b = workBubble({ task, w: { alive: true, name: "Mac", run: { ...run, taskId: "t1" } }, pending: pending as never, busy: null, queue });
    expect(b?.kind).toBe("working");
  });
});

describe.skipIf(!process.env.TEST_DATABASE_URL)("kolejka w liście pracy", async () => {
  const repo = await import("@/lib/repo");
  const { sql } = await import("@/lib/db");
  const { workSummary, agentQueue } = await import("@/lib/agent/work");
  const actions = await import("@/app/actions");
  let owner = "";
  beforeAll(async () => {
    owner = (await repo.ensureOwner()).id;
    await sql()`delete from tasks where owner_id = ${owner}`;
    await sql()`delete from chat_messages where owner_id = ${owner}`;
    await repo.setUserSettings(owner, { queueOrder: [] });
  });
  it("„Następne” stawia pozycję na początku listy pracy (NAJPIERW), a panel pokazuje ją jako pierwszą", async () => {
    const a = await repo.createTask(owner, { title: "Pierwsze zadanie", steps: [{ title: "Sprawdź duplikaty", tool: "clickup" }] });
    const b = await repo.createTask(owner, { title: "Drugie zadanie" });
    await repo.addChat(owner, b.id, "user", "dodaj krok z testem grup");
    let q = await agentQueue(owner, null);
    const keys = q.items.map((x) => x.key);
    expect(keys[0]).toBe(`chat:${b.id}`);   // wiadomości Piotra agent bierze najpierw
    const stepKey = `step:${a.steps[0].id}`;
    expect(keys).toContain(stepKey);
    expect(await actions.queueNext(stepKey)).toContain("pierwsze miejsce");
    q = await agentQueue(owner, null);
    expect(q.items[0]).toMatchObject({ key: stepKey, taskTitle: "Pierwsze zadanie", label: "Krok 01: Sprawdź duplikaty", kind: "krok do zrobienia" });
    const w = await workSummary(owner, { peek: true, audience: "work" });
    const head = w.text.indexOf("NAJPIERW, W TEJ KOLEJNOŚCI");
    expect(head).toBeGreaterThanOrEqual(0);
    expect(head).toBeLessThan(w.text.indexOf("WIADOMOŚCI PIOTRA"));
    expect(w.text).toContain(`1. krok [${a.steps[0].id}]`);
    expect(w.text).toContain(`2. wiadomość w zadaniu [${b.id}]`);
  });
  it("przeciąganie zapisuje całą kolejność; obce klucze odpadają", async () => {
    const q = await agentQueue(owner, null);
    const rev = q.items.map((x) => x.key).reverse();
    await actions.reorderQueue([...rev, "step:00000000-0000-0000-0000-000000000000", "zly klucz"]);
    expect((await repo.userSettings(owner)).queueOrder).toEqual(rev);
    expect((await agentQueue(owner, null)).items.map((x) => x.key)).toEqual(rev);
  });
  it("„Wycofaj” zabiera wiadomość z kolejki, a historia pokazuje ją jako wycofaną", async () => {
    const t = (await repo.listTasks(owner)).find((x) => x.title === "Drugie zadanie")!;
    expect(await actions.withdrawMessages(t.id)).toBe("Wiadomość wycofana z kolejki.");
    expect((await agentQueue(owner, null)).items.some((x) => x.key === `chat:${t.id}`)).toBe(false);
    const { msgs } = await actions.loadChat(t.id, null);
    expect(msgs.at(-1)).toMatchObject({ withdrawn: true });
    expect(await actions.withdrawMessages(t.id)).toBe("Claude już wziął tę wiadomość.");
  });
  it("bieżący krok biegu jest w „Teraz”, nie na liście", async () => {
    const a = (await repo.listTasks(owner)).find((x) => x.title === "Pierwsze zadanie")!;
    const q = await agentQueue(owner, { taskId: a.id, stepId: a.steps[0].id, since: new Date().toISOString(), kind: "work" });
    expect(q.now).toMatchObject({ taskId: a.id, taskTitle: "Pierwsze zadanie", label: "Krok 01: Sprawdź duplikaty" });
    expect(q.items.some((x) => x.stepId === a.steps[0].id)).toBe(false);
  });
  it("paczka 31: pigułka wie, co Claude robi i jaki bieg zatrzymać; rozpisywane zadanie nie wraca jako pozycja kolejki", async () => {
    const a = (await repo.listTasks(owner)).find((x) => x.title === "Pierwsze zadanie")!;
    const q = await agentQueue(owner, { taskId: a.id, stepId: a.steps[0].id, since: new Date().toISOString(), kind: "work", text: "układa kartkę kroku", runId: "r1", stoppable: true });
    expect(q.now).toMatchObject({ what: "układa kartkę kroku 01", runId: "r1", stoppable: true });
    const b = await repo.createTask(owner, { title: "Zadanie bez kroków" });
    expect((await agentQueue(owner, null)).items.some((x) => x.key === `task:${b.id}`)).toBe(true);
    const r = await agentQueue(owner, { taskId: b.id, stepId: null, since: new Date().toISOString(), kind: "work", text: "czyta zadanie" });
    expect(r.now).toMatchObject({ taskTitle: "Zadanie bez kroków", what: "rozpisuje kroki", stoppable: false });
    expect(r.items.some((x) => x.taskId === b.id && x.key === `task:${b.id}`)).toBe(false);
  });
});
