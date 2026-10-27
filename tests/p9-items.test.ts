// Paczka 9, punkt 1: lista elementów (tickety jako kroki) to otwarte kroki Piotra z treścią na kartce; zrobiony odczyt Claude'a
// trzyma „Skąd” rozwinięte; agent może otworzyć zrobiony krok ponownie (reopen_step).
import { describe, it, expect, beforeAll, vi } from "vitest";
import type { Block } from "@/lib/schema";
import { foldsFor, readingResult } from "@/lib/stepcard";
import { ITEMS_RULE } from "@/lib/agent/work";
import { bridgeWorkPrompt } from "@/lib/bridge";
import { step } from "./helpers";

vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));
vi.mock("@/lib/session", async (orig) => ({ ...(await orig<typeof import("@/lib/session")>()), requireOwner: async () => (await import("@/lib/repo")).ensureOwner() }));

const free: Block = { type: "free", markdown: "# Story\n\nAs a manager…", source: { app: "clickup", ref: "869f46dab", url: "https://app.clickup.com/t/869f46dab" } } as Block;
const link: Block = { type: "link", links: [{ url: "https://app.clickup.com/t/869f46dab", title: "Ticket" }] };
const draft: Block = { type: "draft", target: { app: "clickup", where: "Onboarding", url: "https://app.clickup.com/t/x", action: "create" }, subject: "x", body: "y", status: "sent" } as Block;

describe("kartka zrobionego odczytu", () => {
  it("zrobiony odczyt Claude'a z treścią trzyma „Skąd” rozwinięte; zwykły zrobiony krok zwija obie sekcje", () => {
    expect(foldsFor("done", null)).toEqual({ brief: false, material: false });
    expect(foldsFor("done", null, true)).toEqual({ brief: false, material: true });
    expect(foldsFor("done", null, false, true)).toEqual({ brief: false, material: true });
    expect(foldsFor("ready", null, true)).toEqual({ brief: true, material: true });
    expect(readingResult(step({ status: "done", tool: "clickup", doneBy: "agent", blocks: [free, link] }), [free, link])).toBe(true);
    expect(readingResult(step({ status: "done", tool: "clickup", doneBy: "agent", blocks: [link] }), [link])).toBe(false);          // sam link to nie treść
    expect(readingResult(step({ status: "done", tool: "manual", doneBy: "owner", blocks: [free] }), [free])).toBe(false);           // krok Piotra
    expect(readingResult(step({ status: "done", tool: "clickup", doneBy: "agent", blocks: [free, draft] }), [free])).toBe(false);   // wysyłka: karta publikacji
    expect(readingResult(step({ status: "todo", tool: "clickup", blocks: [free] }), [free])).toBe(false);
  });
  it("zasada o liście elementów jest w prompcie mostka i mówi: kroki Piotra, tytuł elementu, treść 1:1, bez done", () => {
    expect(ITEMS_RULE).toContain("tool manual");
    expect(ITEMS_RULE).toContain("bez przerabiania na czasownik");
    expect(ITEMS_RULE).toContain("treścią elementu 1:1");
    expect(bridgeWorkPrompt()).toContain(ITEMS_RULE);
  });
});

describe.skipIf(!process.env.TEST_DATABASE_URL)("reopen_step i lista pracy", async () => {
  const repo = await import("@/lib/repo");
  const { sql } = await import("@/lib/db");
  const { workSummary } = await import("@/lib/agent/work");
  const mcp = await import("@/app/api/mcp/route");
  let owner = "", client = "";
  const call = async (tok: string, name: string, args: Record<string, unknown>) => {
    const r = await mcp.POST(new Request("http://x/api/mcp", { method: "POST", headers: { authorization: `Bearer ${tok}`, "content-type": "application/json", accept: "application/json, text/event-stream" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }) }));
    const msgs = (await r.text()).split("\n").filter((l) => l.startsWith("data: ")).map((l) => JSON.parse(l.slice(6)));
    const m = msgs.find((x) => x.id === 1);
    return ((m?.result?.content ?? []) as { text?: string }[]).map((c) => c.text ?? "").join("\n") + (m?.error ? m.error.message : "");
  };
  beforeAll(async () => {
    owner = (await repo.ensureOwner()).id;
    await sql()`delete from tasks where owner_id = ${owner}`;
    await sql()`delete from api_tokens where owner_id = ${owner}`;
    client = await repo.createApiToken(owner, "Claude", "client");
  });
  it("zadanie bez kroków dostaje w liście pracy zasadę o liście elementów", async () => {
    await repo.createTask(owner, { title: "Tickety onboardingu jako kroki", source: "każdy ticket jako osobny krok" });
    const w = await workSummary(owner, { audience: "client", peek: true });
    expect(w.text).toContain("ZADANIA BEZ KROKÓW");
    expect(w.text).toContain("Lista elementów:");
  });
  it("reopen_step: zrobiony odczyt wraca do zrobienia jako krok Piotra z nowym tytułem; zadanie przestaje być ukończone; wysłanego szkicu nie otwiera", async () => {
    const t = await repo.createTask(owner, { title: "Z ticketami" });
    const added = await call(client, "add_steps", { taskId: t.id, steps: [{ title: "Popraw Finish Later", tool: "clickup", done: "Story w statusie dev ready; treść na kartce." }] });
    const sid = (JSON.parse(added) as { steps: { id: string }[] }).steps[0].id;
    let cur = (await repo.getTask(owner, t.id))!;
    expect(cur.steps[0].status).toBe("done");
    expect(cur.doneAt).not.toBeNull();
    expect(await call(client, "reopen_step", { stepId: sid, tool: "manual", title: "Finish Later in onboarding", est: 5 })).toBe("Krok wrócił do zrobienia.");
    cur = (await repo.getTask(owner, t.id))!;
    expect(cur.steps[0]).toMatchObject({ status: "todo", tool: "manual", title: "Finish Later in onboarding", estMin: 5, doneBy: null });
    expect(cur.doneAt).toBeNull();
    expect(await call(client, "reopen_step", { stepId: sid })).toBe("Ten krok nie jest zrobiony.");
    // krok z wysłanym szkicem zostaje zrobiony
    const s2 = (await repo.addSteps(t.id, [{ title: "Story w ClickUpie", tool: "clickup", needsApproval: true }]))[0];
    await repo.updateStep(s2.id, { status: "draft", blocks: [{ ...draft, status: "proposed" } as Block] });
    expect(await repo.approveDraft(owner, s2.id)).toBe(true);
    expect(await repo.markSendStarted(owner, s2.id)).toBe(true);
    expect(await repo.completeSend(owner, s2.id, { summary: "ok", link: "https://app.clickup.com/t/abc" })).toBe(true);
    expect(await call(client, "reopen_step", { stepId: s2.id })).toContain("Nie otworzyłem");
    expect((await repo.getTask(owner, t.id))!.steps.find((s) => s.id === s2.id)!.status).toBe("done");
  });
});
