// Paczka 7, punkt 4.4: „Plik na Macu” to nie wysyłka. Plik zapisuje tylko bieg pracy mostka (aplikacja 0.1.7) w folderze na pliki;
// szkic do „pliku” odpada u agenta, a stary zatwierdzony szkic nigdzie nie idzie.
import { describe, it, expect, beforeAll, vi } from "vitest";
import { readFileSync } from "node:fs";
import type { Block } from "@/lib/schema";
import { isFilePath, fileName } from "@/lib/safeurl";
import { normalizeTool, toolLabel } from "@/lib/schema";
import { isExternalApp, isLocalFile } from "@/lib/agent/approval";

vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));
vi.mock("@/lib/session", async (orig) => ({ ...(await orig<typeof import("@/lib/session")>()), requireOwner: async () => (await import("@/lib/repo")).ensureOwner() }));

describe("plik na Macu bez bazy", () => {
  it("klucz file, alias tylko „plik”; ścieżka od / albo ~/, bez „..”; nazwa pliku z końca ścieżki", () => {
    expect(normalizeTool("plik")).toBe("file"); expect(normalizeTool("Plik na Macu")).toBe("file"); expect(normalizeTool("dysk")).toBe("dysk");
    expect(toolLabel("file")).toBe("Plik na Macu");
    expect(isExternalApp("file")).toBe(false); expect(isLocalFile("plik")).toBe(true); expect(isLocalFile("slack")).toBe(false);
    expect(isFilePath("~/Documents/robocze/2026-10-20-us.md")).toBe(true);
    expect(isFilePath("/Users/p/x.md")).toBe(true);
    expect(isFilePath("http://x")).toBe(false); expect(isFilePath("x.md")).toBe(false); expect(isFilePath("/Users/p/../x")).toBe(false); expect(isFilePath("/a\nb")).toBe(false);
    expect(fileName("~/Documents/robocze/2026-10-20-us.md")).toBe("2026-10-20-us.md");
  });
});

describe.skipIf(!process.env.TEST_DATABASE_URL)("plik na Macu: kto może, a kto nie", async () => {
  const repo = await import("@/lib/repo");
  const { sql } = await import("@/lib/db");
  const { workSummary } = await import("@/lib/agent/work");
  const actions = await import("@/app/actions");
  const mcp = await import("@/app/api/mcp/route");
  const runRoute = await import("@/app/api/bridge/run/route");
  let owner = "", client = "", bridge = "";
  const call = async (tok: string, name: string, args: Record<string, unknown>) => {
    const r = await mcp.POST(new Request("http://x/api/mcp", { method: "POST", headers: { authorization: `Bearer ${tok}`, "content-type": "application/json", accept: "application/json, text/event-stream" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }) }));
    const msgs = (await r.text()).split("\n").filter((l) => l.startsWith("data: ")).map((l) => JSON.parse(l.slice(6)));
    const m = msgs.find((x) => x.id === 1);
    return ((m?.result?.content ?? []) as { text?: string }[]).map((c) => c.text ?? "").join("\n") + (m?.error ? m.error.message : "");
  };
  const get = async (taskId: string, stepId: string) => (await repo.getTask(owner, taskId))!.steps.find((s) => s.id === stepId)!;
  const chat = async (taskId: string) => (await sql()`select text from chat_messages where task_id = ${taskId} and role = 'agent' order by created_at`).map((r) => r.text as string);
  const workToken = async () => { const run = (await repo.startBridgeRun(owner, null, "mini", "work"))!; return { run, tok: await repo.createRunToken(owner, { kind: "work", runId: run.id }, 30) }; };
  const plikDraft = (body = "Treść story"): Block => ({ type: "draft", target: { app: "plik", where: "robocze/dev-ready", action: "create" }, body, status: "proposed" });

  beforeAll(async () => {
    owner = (await repo.ensureOwner()).id;
    await sql()`delete from tasks where owner_id = ${owner}`;
    await sql()`delete from bridge_runs where owner_id = ${owner}`;
    await sql()`delete from api_tokens where owner_id = ${owner}`;
    client = await repo.createApiToken(owner, "Claude", "client");
    bridge = await repo.createApiToken(owner, "Mac", "bridge");
  });

  it("set_blocks ze szkicem do „pliku”: odmowa z instrukcją dla biegu pracy (Write) albo dla klienta (0.1.7)", async () => {
    const t = await repo.createTask(owner, { title: "Story do pliku", steps: [{ title: "Zapisz story", tool: "claude", needsApproval: true }] });
    const sid = t.steps[0].id;
    const { run, tok } = await workToken();
    const w = await call(tok, "set_blocks", { stepId: sid, blocks: [plikDraft()] });
    expect(w).toContain("Nie zapisałem"); expect(w).toContain("Write"); expect(w).toContain("Foldery na pliki");
    await repo.endBridgeRun(owner, run.id, "done");
    const c = await call(client, "set_blocks", { stepId: sid, blocks: [plikDraft()] });
    expect(c).toContain("Nie zapisałem"); expect(c).toContain("0.1.7"); expect(c).not.toContain("Foldery na pliki");
    expect((await get(t.id, sid)).blocks).toBeNull();
  });

  it("complete_step z polem file: zapisuje ścieżkę tylko z biegu pracy; klient i zły napis odpadają; start_step kroku file tylko z biegu pracy", async () => {
    const t = await repo.createTask(owner, { title: "Plik na Macu", steps: [{ title: "Zapisz story", tool: "file", needsApproval: true }] });
    const sid = t.steps[0].id;
    expect((await get(t.id, sid)).needsApproval).toBe(false);   // plik nigdy nie czeka na zgodę
    expect(await call(client, "start_step", { stepId: sid })).toContain("0.1.7");
    expect(await call(client, "complete_step", { stepId: sid, summary: "Zapisane", file: "~/Documents/robocze/a.md" })).toContain("Nie zamknąłem");
    const { run, tok } = await workToken();
    expect(await call(tok, "complete_step", { stepId: sid, summary: "Zapisane", file: "http://x" })).toContain("pełna ścieżka");
    expect(await call(tok, "start_step", { stepId: sid })).toBe("Krok w toku.");
    expect(await call(tok, "complete_step", { stepId: sid, summary: "Zapisane", file: "~/Documents/robocze/2026-10-20-us.md" })).toContain("Krok zapisany");
    await repo.endBridgeRun(owner, run.id, "done");
    const s = await get(t.id, sid);
    expect(s.status).toBe("done"); expect(s.filePath).toBe("~/Documents/robocze/2026-10-20-us.md"); expect(s.link).toBeNull();
  });

  it("lista pracy: sekcja PLIKI NA MACU tylko dla biegu pracy; klient i stary mostek nie widzą kroku file", async () => {
    const t = await repo.createTask(owner, { title: "Lista z plikiem", steps: [{ title: "Zapisz notatkę", tool: "file" }] });
    const w = await workSummary(owner, { peek: true, audience: "work" });
    expect(w.text).toContain("PLIKI NA MACU"); expect(w.text).toContain(t.steps[0].id); expect(w.counts.ready).toBeGreaterThanOrEqual(1);
    for (const audience of ["client", "bridge-v1"] as const) {
      const x = await workSummary(owner, { peek: true, audience });
      expect(x.text).not.toContain("PLIKI NA MACU"); expect(x.text).not.toContain(t.steps[0].id);
    }
  });

  it("stary zatwierdzony szkic do „pliku”: „Zatwierdź” go nie przyjmuje, a bieg wysyłki cofa zgodę z notatką", async () => {
    const t = await repo.createTask(owner, { title: "Stary szkic do pliku", steps: [{ title: "Zapisz story", tool: "claude", needsApproval: true }] });
    const sid = t.steps[0].id;
    await repo.updateStep(sid, { status: "draft", blocks: [plikDraft()] });
    await actions.approveStep(t.id, sid);
    let s = await get(t.id, sid);
    expect(s.status).toBe("draft"); expect(s.approvedAt).toBeNull();
    expect((await chat(t.id)).join("\n")).toContain("to plik na Macu, nie wysyłka");
    expect(await repo.approveDraft(owner, sid)).toBe(true);   // dawna droga: zgoda zapisana wprost
    const r = await runRoute.POST(new Request("http://x/api/bridge/run", { method: "POST", headers: { Authorization: `Bearer ${bridge}` }, body: JSON.stringify({ bridge: "mini", v: 2, kind: "send" }) }));
    expect(r.status).toBe(204);
    s = await get(t.id, sid);
    expect(s.approvedAt).toBeNull(); expect(repo.draftOf(s)?.status).toBe("proposed");
    expect((await chat(t.id)).join("\n")).toContain("Nie wysłałem");
  });

  it("migracja 0019: otwarty szkic „plik” staje się krokiem file z klockiem free; wysłany zostaje", async () => {
    const t = await repo.createTask(owner, { title: "Migracja plików", steps: [{ title: "Otwarty", tool: "plik", needsApproval: true }, { title: "Wysłany", tool: "plik", needsApproval: true }] });
    const [a, b] = t.steps.map((s) => s.id);
    await sql()`update steps set tool = 'plik', needs_approval = true, status = 'draft', blocks = ${sql().json([plikDraft("Treść A")] as never)} where id = ${a}`;
    await sql()`update steps set tool = 'plik', status = 'done', blocks = ${sql().json([{ ...plikDraft("Treść B"), status: "sent" }] as never)} where id = ${b}`;
    await sql().unsafe(readFileSync("supabase/migrations/0019_step_file.sql", "utf8"));
    const sa = await get(t.id, a), sb = await get(t.id, b);
    expect(sa).toMatchObject({ tool: "file", needsApproval: false, status: "todo", approvedAt: null });
    expect(sa.blocks).toEqual([{ type: "free", title: "robocze/dev-ready", markdown: "Treść A" }]);
    expect(sb).toMatchObject({ tool: "file", status: "done" });
    expect(repo.draftOf(sb)?.status).toBe("sent");
  });
});
