// Paczka 19, punkt 2: krok „Zleć w projekcie: …” dodany na wyraźne polecenie Piotra w rozmowie zadania (add_steps z cloudFrom) rusza w chmurze sam;
// czekający na inne kroki rusza, gdy się skończą. „Wdróż na produkcję” i kroki bez cloudFrom dalej czekają na kliknięcie. Pomijane bez TEST_DATABASE_URL.
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { stepLook } from "@/lib/canvas/vm";
import type { Step } from "@/lib/schema";

vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));
vi.mock("@/lib/session", async (orig) => ({ ...(await orig<typeof import("@/lib/session")>()), requireOwner: async () => (await import("@/lib/repo")).ensureOwner() }));

describe("kafelek kroku zleconego w rozmowie", () => {
  it("czekający na inne kroki to Zaplanowane, nie Agent pracuje", () => {
    const s = { tool: "manual", title: "Zleć w projekcie: x", status: "todo", blocks: null, cloud: { state: "auto", at: "2026-10-25T19:00:00Z" } } as unknown as Step;
    expect(stepLook(s, "blocked", false).key).toBe("plan-me");
    expect(stepLook({ ...s, cloud: { state: "queued", at: "2026-10-25T19:00:00Z" } } as Step, "ready", false).key).toBe("live");
  });
});

describe.skipIf(!process.env.TEST_DATABASE_URL)("zlecenie do chmury z rozmowy", async () => {
  const repo = await import("@/lib/repo");
  const { sql } = await import("@/lib/db");
  const mcp = await import("@/app/api/mcp/route");
  const actions = await import("@/app/actions");
  let owner = "", client = "";
  const call = async (name: string, args: Record<string, unknown>) => {
    const r = await mcp.POST(new Request("http://x/api/mcp", { method: "POST", headers: { authorization: `Bearer ${client}`, "content-type": "application/json", accept: "application/json, text/event-stream" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }) }));
    const msgs = (await r.text()).split("\n").filter((l) => l.startsWith("data: ")).map((l) => JSON.parse(l.slice(6)));
    const m = msgs.find((x) => x.id === 1);
    return ((m?.result?.content ?? []) as { text?: string }[]).map((c) => c.text ?? "").join("\n") + (m?.error ? m.error.message : "");
  };
  const steps = async (taskId: string) => (await repo.getTask(owner, taskId))!.steps;

  beforeAll(async () => {
    owner = (await repo.ensureOwner()).id;
    await sql()`delete from tasks where owner_id = ${owner}`;
    await sql()`delete from api_tokens where owner_id = ${owner}`;
    await sql()`delete from chat_messages where owner_id = ${owner}`;
    client = await repo.createApiToken(owner, "Claude", "client");
  });
  afterAll(async () => { await sql().end({ timeout: 2 }); });

  it("polecenie Piotra: krok bez zależności rusza od razu, zależny po swoim kroku, wdrożenie czeka", async () => {
    const t = await repo.createTask(owner, { title: "Prototyp", steps: [{ title: "Zdecyduj o wariancie", tool: "manual" }, { title: "Wdróż na produkcję", tool: "manual" }] });
    const [decide, deploy] = t.steps;
    const msg = await repo.addChat(owner, t.id, "user", "Wprowadź te zmiany do obecnego prototypu");
    const out = await call("add_steps", { taskId: t.id, cloudFrom: msg, before: deploy.id, steps: [
      { title: "Zleć w projekcie: poprawki prototypu", tool: "manual", dependsOn: [] },
      { title: "Zleć w projekcie: wdrożenie wariantu", tool: "manual", dependsOn: [decide.id] },
      { title: "Sprawdź zrzuty", tool: "claude", dependsOn: [] },
    ] });
    expect(out).toContain('"cloud": true');
    let all = await steps(t.id);
    const fix = all.find((s) => s.title.endsWith("poprawki prototypu"))!, impl = all.find((s) => s.title.endsWith("wdrożenie wariantu"))!;
    expect(fix.cloud?.state).toBe("queued");
    expect(impl.cloud?.state).toBe("auto");
    expect(all.find((s) => s.title === "Sprawdź zrzuty")!.cloud ?? null).toBeNull();
    expect(all.find((s) => s.id === deploy.id)!.cloud ?? null).toBeNull();
    expect(await call("cloud_work", {})).toContain(fix.id);
    expect(await call("cloud_work", {})).not.toContain(impl.id);
    // decyzja zrobiona: krok czekający rusza sam, z linią w rozmowie
    await actions.markDone(t.id, decide.id);
    all = await steps(t.id);
    expect(all.find((s) => s.id === impl.id)!.cloud?.state).toBe("queued");
    expect((await repo.listChat(owner, t.id, 50)).some((m) => m.text.includes("tak jak prosiłeś w rozmowie"))).toBe(true);
    expect(all.find((s) => s.id === deploy.id)!.cloud ?? null).toBeNull();
  });

  it("bez cloudFrom albo z cudzą wiadomością: krok czeka na kliknięcie; Wycofaj zdejmuje zlecenie z rozmowy", async () => {
    const t = await repo.createTask(owner, { title: "Inne", steps: [{ title: "Zdecyduj", tool: "manual" }] });
    const agentMsg = await repo.addChat(owner, t.id, "agent", "Dopiszę kroki.");
    expect(await call("add_steps", { taskId: t.id, cloudFrom: agentMsg, steps: [{ title: "Zleć w projekcie: a", tool: "manual" }] })).toContain("Nie dodałem kroków");
    await call("add_steps", { taskId: t.id, steps: [{ title: "Zleć w projekcie: b", tool: "manual" }] });
    expect((await steps(t.id)).find((s) => s.title.endsWith(": b"))!.cloud ?? null).toBeNull();
    const msg = await repo.addChat(owner, t.id, "user", "Zrób to w kodzie");
    await call("add_steps", { taskId: t.id, cloudFrom: msg, steps: [{ title: "Zleć w projekcie: c", tool: "manual", dependsOn: [t.steps[0].id] }] });
    const c = (await steps(t.id)).find((s) => s.title.endsWith(": c"))!;
    expect(c.cloud?.state).toBe("auto");
    await actions.cancelCloudRun(t.id, c.id);
    expect((await steps(t.id)).find((s) => s.id === c.id)!.cloud ?? null).toBeNull();
  });
});
