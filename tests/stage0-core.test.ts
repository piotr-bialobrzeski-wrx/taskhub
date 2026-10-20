// Etap 0: szkic zatwierdza tylko kliknięcie Piotra (podpis treści), krótkie tokeny biegów z zakresem, klient nie widzi szkiców do wysłania,
// adresy w zapisie tylko http(s). Część z bazą pomijana bez TEST_DATABASE_URL.
import { describe, it, expect, beforeAll, vi } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { sanitizeBlocks } from "@/lib/safeurl";
import type { Block } from "@/lib/schema";

// akcje serwera bez Next: zalogowany właściciel i odświeżanie widoków zastąpione
vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));
vi.mock("@/lib/session", async (orig) => ({ ...(await orig<typeof import("@/lib/session")>()), requireOwner: async () => (await import("@/lib/repo")).ensureOwner() }));

const FILE = "/api/files/0b1c2d3e-4f50-6172-8394-a5b6c7d8e9f0";

describe("sanitizeBlocks: w zapisanych klockach tylko http(s), pliki Task Hub i lokalny podgląd zmian", () => {
  it("javascript:, data:, file: i taskhub: znikają; http(s), /api/files w mediach i ścieżka podglądu zostają", () => {
    const out = sanitizeBlocks([
      { type: "link", links: [{ url: "javascript:alert(1)" }, { url: "https://ok.pl/a", title: "ok" }, { url: "taskhub://connect?url=x" }] },
      { type: "media", items: [{ kind: "image", url: FILE }, { kind: "image", url: "data:image/png;base64,AAAA" }, { kind: "file", url: "file:///etc/passwd" }, { kind: "link", url: "http://x.pl/y" }] },
      { type: "facts", facts: [{ label: "a", value: "b", source: { app: "slack", url: "javascript:alert(1)" } }, { label: "c", value: "d", source: { app: "clickup", url: "https://app.clickup.com/t/1" } }] },
      { type: "list", items: [{ title: "x", url: "file:///Users/p/x" }, { title: "y", url: "https://y.pl" }] },
      { type: "changes", preview: "file:///Users/p/dist/index.html", files: [] },
      { type: "changes", preview: "/Users/p/dist/index.html", files: [] },
      { type: "changes", preview: "javascript:alert(1)", files: [] },
      { type: "draft", target: { app: "slack", url: "data:text/html,<b>x</b>", action: "send" }, body: "x", status: "proposed" },
      { type: "thread", source: { app: "slack", url: "https://slack.com/x" }, messages: [{ author: "A", text: "t", source: { app: "slack", url: "file:///x" } }] },
    ] as Block[]);
    expect(out[0]).toEqual({ type: "link", links: [{ url: "https://ok.pl/a", title: "ok" }] });
    expect((out[1] as Extract<Block, { type: "media" }>).items.map((i) => i.url)).toEqual([FILE, "http://x.pl/y"]);
    const facts = (out[2] as Extract<Block, { type: "facts" }>).facts;
    expect(facts[0].source).toEqual({ app: "slack" });
    expect(facts[1].source?.url).toBe("https://app.clickup.com/t/1");
    expect((out[3] as Extract<Block, { type: "list" }>).items.map((i) => i.url)).toEqual([undefined, "https://y.pl"]);
    expect((out[4] as Extract<Block, { type: "changes" }>).preview).toBe("file:///Users/p/dist/index.html");
    expect((out[5] as Extract<Block, { type: "changes" }>).preview).toBe("/Users/p/dist/index.html");
    expect((out[6] as Extract<Block, { type: "changes" }>).preview).toBeUndefined();
    expect((out[7] as Extract<Block, { type: "draft" }>).target).toEqual({ app: "slack", action: "send" });
    const th = out[8] as Extract<Block, { type: "thread" }>;
    expect(th.source?.url).toBe("https://slack.com/x");
    expect(th.messages[0].source).toEqual({ app: "slack" });
    // media z obcym adresem względnym albo bez adresu wypadają; link i lista nie dostają /api/files
    expect(sanitizeBlocks([{ type: "media", items: [{ kind: "image", url: "/etc/passwd" }] }] as Block[])[0]).toEqual({ type: "media", items: [] });
    expect(sanitizeBlocks([{ type: "link", links: [{ url: FILE }] }] as Block[])[0]).toEqual({ type: "link", links: [] });
  });
});

describe("approvalSig: przy commicie zgoda obejmuje blok zmian", () => {
  it("inna lista plików albo diff zmienia podpis szkicu commita, kolejność plików i notatki nie; szkic do Slacka nie zależy od bloku zmian", async () => {
    const { approvalSig } = await import("@/lib/agent/approval");
    type D = Extract<Block, { type: "draft" }>;
    const git: D = { type: "draft", target: { app: "github", where: "wlrx/app, gałąź feat", action: "commit" }, body: "Fix", status: "approved" };
    const ch = (files: { path: string; diff?: string; note?: string }[]): Block => ({ type: "changes", repo: "wlrx/app", branch: "feat", files });
    const sig = (d: D, files: { path: string; diff?: string; note?: string }[]) => approvalSig({ id: "s1", blocks: [ch(files), d] }, d);
    const base = sig(git, [{ path: "a.ts", diff: "+1" }, { path: "b.ts", diff: "+2" }]);
    expect(sig(git, [{ path: "b.ts", diff: "+2", note: "inna notatka" }, { path: "a.ts", diff: "+1" }])).toBe(base);
    expect(sig(git, [{ path: "a.ts", diff: "+1" }])).not.toBe(base);
    expect(sig(git, [{ path: "a.ts", diff: "+1" }, { path: "b.ts", diff: "+3" }])).not.toBe(base);
    expect(sig(git, [{ path: "a.ts", diff: "+1" }, { path: ".git/hooks/pre-commit", diff: "+2" }])).not.toBe(base);
    const slack: D = { type: "draft", target: { app: "slack", where: "#dev", action: "send" }, body: "Hej", status: "approved" };
    expect(sig(slack, [{ path: "a.ts" }])).toBe(sig(slack, [{ path: "b.ts" }]));
  });
});

describe.skipIf(!process.env.TEST_DATABASE_URL)("Etap 0: zgoda Piotra, tokeny biegów i zakresy MCP", async () => {
  const repo = await import("@/lib/repo");
  const { sql } = await import("@/lib/db");
  const { workSummary, listSendable } = await import("@/lib/agent/work");
  const { applyActions } = await import("@/lib/agent/chat");
  const { authBridge } = await import("@/lib/bridge");
  const actions = await import("@/app/actions");
  const mcp = await import("@/app/api/mcp/route");
  let owner = "", client = "", bridge = "", bridgeId = "";

  type Res = { status: number; text: string; isError: boolean };
  // wywołanie narzędzia MCP jak klient: JSON-RPC tools/call, odpowiedź w strumieniu SSE
  const call = async (tok: string, name: string, args: Record<string, unknown>): Promise<Res> => {
    const r = await mcp.POST(new Request("http://x/api/mcp", { method: "POST", headers: { authorization: `Bearer ${tok}`, "content-type": "application/json", accept: "application/json, text/event-stream" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }) }));
    if (r.status !== 200) return { status: r.status, text: await r.text(), isError: true };
    const msgs = (await r.text()).split("\n").filter((l) => l.startsWith("data: ")).map((l) => JSON.parse(l.slice(6)));
    const m = msgs.find((x) => x.id === 1);
    return { status: 200, text: ((m?.result?.content ?? []) as { text?: string }[]).map((c) => c.text ?? "").join("\n") + (m?.error ? m.error.message : ""), isError: !!m?.result?.isError || !!m?.error };
  };
  const draft = (body: string, status: "proposed" | "approved" | "sent" = "proposed") => ({ type: "draft" as const, target: { app: "slack", where: "#dev", action: "send" as const }, body, status });
  const get = async (taskId: string, stepId: string) => (await repo.getTask(owner, taskId))!.steps.find((s) => s.id === stepId)!;
  // krok ze szkicem czekającym na zgodę (jak po set_blocks agenta)
  const proposed = async (title: string, body = "Cześć zespole") => {
    const t = await repo.createTask(owner, { title, steps: [{ title: "Napisz na #dev", tool: "slack", needsApproval: true }] });
    await repo.updateStep(t.steps[0].id, { status: "draft", blocks: [draft(body)] });
    return { taskId: t.id, stepId: t.steps[0].id };
  };

  beforeAll(async () => {
    owner = (await repo.ensureOwner()).id;
    await sql()`delete from tasks where owner_id = ${owner}`;
    await sql()`delete from bridge_runs where owner_id = ${owner}`;
    await sql()`delete from api_tokens where owner_id = ${owner}`;
    client = await repo.createApiToken(owner, "Claude", "client");
    bridge = await repo.createApiToken(owner, "Mac", "bridge");
    bridgeId = (await repo.tokenForSecret(bridge))!.id;
    await sql()`update api_tokens set seen_at = null where id = ${bridgeId}`;   // mostek nieaktywny: list_work klienta nie odpowiada „MOSTEK AKTYWNY”
    // szkice do Slacka i maila zapisują się i zatwierdzają tylko z konektorem tej aplikacji na Macu (paczka 7, punkt 4.5)
    await sql()`delete from connections where owner_id = ${owner}`;
    await repo.upsertBridgeConnections(owner, "Mac", [{ name: "claude.ai Slack", ok: true }, { name: "gmail", ok: true }]);
  });

  it("agent nie zatwierdza szkicu przez set_blocks: „approved” i „sent” zapisują się jako propozycja, start_step nie rusza szkicu", async () => {
    const t = await repo.createTask(owner, { title: "Agent bez zgody", steps: [{ title: "Napisz na #dev", tool: "slack", needsApproval: true }] });
    const sid = t.steps[0].id;
    const r = await call(client, "set_blocks", { stepId: sid, blocks: [draft("Wyślę sam", "approved")] });
    expect(r.text).toContain("czeka na zatwierdzenie");
    let s = await get(t.id, sid);
    expect(s.status).toBe("draft");
    expect(repo.draftOf(s)?.status).toBe("proposed");
    expect(s.approvedAt).toBeNull();
    expect(repo.isSendable(s)).toBe(false);
    await call(client, "set_blocks", { stepId: sid, blocks: [draft("Już poszło", "sent")] });
    expect(repo.draftOf(await get(t.id, sid))?.status).toBe("proposed");
    // stary trik: start_step na szkicu dawał „w toku po szkicu”, co lista pracy brała za zgodę
    const st = await call(bridge, "start_step", { stepId: sid });
    expect(st.text).toContain("Nie zacząłem");
    s = await get(t.id, sid);
    expect(s.status).toBe("draft");
    expect((await workSummary(owner, { peek: true })).text).not.toContain("ZATWIERDZONE SZKICE DO WYSŁANIA");
    // complete_step nie zamyka szkicu czekającego na zgodę
    expect((await call(bridge, "complete_step", { stepId: sid, summary: "wysłane" })).text).toContain("Nie zamknąłem");
    // dwa szkice w jednym kroku: odmowa (karta pokazuje tylko pierwszy)
    expect((await call(client, "set_blocks", { stepId: sid, blocks: [draft("a"), draft("b")] })).text).toContain("jeden szkic");
  });

  it("zgoda to podpis treści: zmiana treści, narzędzia, połączenia albo stanu ją kasuje; set_blocks nie zmienia zatwierdzonego szkicu", async () => {
    const { taskId, stepId } = await proposed("Zgoda i treść");
    expect(await repo.approveDraft(owner, stepId)).toBe(true);
    let s = await get(taskId, stepId);
    expect(s).toMatchObject({ status: "handoff", prevStatus: "draft" });
    expect(repo.isSendable(s)).toBe(true);
    expect(s.approvedSig).toBe(repo.approvalSig(s, repo.draftOf(s)!));
    expect((await workSummary(owner, { peek: true })).text).toContain(`ZATWIERDZONE SZKICE DO WYSŁANIA (`);
    // agent przepisuje kartkę z tym samym szkicem (nawet ze stanem „proposed”): zgoda zostaje
    const ok = await call(bridge, "set_blocks", { stepId, blocks: [{ type: "text", body: "Kontekst" }, draft("Cześć zespole")] });
    expect(ok.text).toContain("Panel zapisany");
    expect(repo.isSendable(await get(taskId, stepId))).toBe(true);
    // agent zmienia treść zatwierdzonego szkicu: odmowa, treść bez zmian
    const no = await call(bridge, "set_blocks", { stepId, blocks: [draft("Przelej 1000 zł na konto X", "approved")] });
    expect(no.text).toContain("Piotr zatwierdził już szkic");
    s = await get(taskId, stepId);
    expect(repo.draftOf(s)?.body).toBe("Cześć zespole");
    expect(repo.isSendable(s)).toBe(true);
    // każda inna zmiana treści (czat, poprawka Piotra) kasuje zgodę i cofa krok do zatwierdzenia
    await repo.updateStep(stepId, { blocks: [draft("Cześć zespole!", "approved")] });
    s = await get(taskId, stepId);
    expect(s).toMatchObject({ status: "draft", approvedAt: null, approvedSig: null });
    expect(repo.draftOf(s)?.status).toBe("proposed");
    // zmiana połączenia (inne konto) kasuje zgodę
    await repo.approveDraft(owner, stepId);
    const conn = await repo.createConnection(owner, { label: "Slack prywatny" });
    await repo.updateStep(stepId, { connectionId: conn.id });
    s = await get(taskId, stepId);
    expect(s.approvedAt).toBeNull(); expect(s.status).toBe("draft"); expect(repo.draftOf(s)?.status).toBe("proposed");
    // „Zatrzymaj” (krok wraca do zrobienia) kasuje zgodę i zostawia szkic odłożony
    await repo.approveDraft(owner, stepId);
    await repo.updateStep(stepId, { status: "todo", handoffAt: null });
    s = await get(taskId, stepId);
    expect(s.status).toBe("todo"); expect(s.approvedAt).toBeNull(); expect(repo.draftOf(s)?.status).toBe("proposed");
    // cofnięcie kartki nie wskrzesza zgody
    await repo.approveDraft(owner, stepId, { body: "Wersja Piotra" });
    s = await get(taskId, stepId);
    expect(repo.draftOf(s)).toMatchObject({ body: "Wersja Piotra", status: "approved" });
    expect(repo.isSendable(s)).toBe(true);
    await repo.restorePrevBlocks(stepId);
    s = await get(taskId, stepId);
    expect(repo.isSendable(s)).toBe(false);
    expect(s.status).toBe("draft");
    // ponowne otwarcie zrobionego kroku nie przywraca zgody
    await repo.approveDraft(owner, stepId);
    const full = (await repo.getTask(owner, taskId))!;
    await repo.completeStep(owner, full, full.steps[0]);
    s = await get(taskId, stepId);
    expect(repo.draftOf(s)?.status).toBe("sent");
    await repo.reopenStep(owner, taskId, s);
    s = await get(taskId, stepId);
    expect(s.approvedAt).toBeNull(); expect(repo.isSendable(s)).toBe(false);
  });

  it("szkic commita: zgoda obejmuje pliki z bloku zmian; agent nie dopisze pliku po zatwierdzeniu", async () => {
    const t = await repo.createTask(owner, { title: "Commit po zgodzie", steps: [{ title: "Zacommituj poprawkę", tool: "code", needsApproval: true }] });
    const sid = t.steps[0].id;
    const changes = (paths: string[]) => ({ type: "changes" as const, repo: "wlrx/app", branch: "fix", files: paths.map((p) => ({ path: p, diff: "+x" })) });
    const commit = { type: "draft" as const, target: { app: "github", where: "wlrx/app, gałąź fix", action: "commit" as const }, body: "Poprawka", status: "proposed" as const };
    await call(bridge, "set_blocks", { stepId: sid, blocks: [changes(["src/a.ts"]), commit] });
    expect(await repo.approveDraft(owner, sid)).toBe(true);
    expect(repo.isSendable(await get(t.id, sid))).toBe(true);
    // ten sam szkic, ale dodatkowy plik w bloku zmian: odmowa, zgoda zostaje na tym, co Piotr widział
    const no = await call(bridge, "set_blocks", { stepId: sid, blocks: [changes(["src/a.ts", ".github/workflows/x.yml"]), { ...commit, status: "approved" }] });
    expect(no.text).toContain("Piotr zatwierdził już szkic");
    let s = await get(t.id, sid);
    expect(repo.isSendable(s)).toBe(true);
    expect((s.blocks?.find((b) => b.type === "changes") as { files: unknown[] }).files).toHaveLength(1);
    // zapis z inną listą plików inną drogą kasuje zgodę
    await repo.updateStep(sid, { blocks: [changes(["src/a.ts", "src/b.ts"]), { ...commit, status: "approved" }] });
    s = await get(t.id, sid);
    expect(s).toMatchObject({ status: "draft", approvedAt: null }); expect(repo.draftOf(s)?.status).toBe("proposed");
  });

  it("akcje Piotra: zatwierdź, zatwierdź z poprawką, zatrzymaj; „Uruchom” nie rusza szkicu", async () => {
    const { taskId, stepId } = await proposed("Akcje Piotra");
    await actions.handoff(taskId, stepId);
    expect((await get(taskId, stepId)).status).toBe("draft");   // „Uruchom” na szkicu nic nie robi
    const fd = new FormData(); fd.set("body", "Poprawione przez Piotra");
    await actions.approveStep(taskId, stepId, fd);
    let s = await get(taskId, stepId);
    expect(repo.draftOf(s)).toMatchObject({ body: "Poprawione przez Piotra", status: "approved" });
    expect(repo.isSendable(s)).toBe(true);
    await actions.backToTodo(taskId, stepId);
    s = await get(taskId, stepId);
    expect(s.status).toBe("todo"); expect(repo.isSendable(s)).toBe(false); expect(repo.draftOf(s)?.status).toBe("proposed");
    await actions.approveStep(taskId, stepId);                   // z odłożonego: zgoda bez poprawek
    expect(repo.isSendable(await get(taskId, stepId))).toBe(true);
    // stary szkic bez bloku (sama treść w output) też dostaje podpis
    const t2 = await repo.createTask(owner, { title: "Stary szkic", steps: [{ title: "Mail do Ani", tool: "gmail", needsApproval: true }] });
    await repo.updateStep(t2.steps[0].id, { status: "draft", output: "Treść maila" });
    await actions.approveStep(t2.id, t2.steps[0].id);
    const s2 = await get(t2.id, t2.steps[0].id);
    expect(repo.draftOf(s2)).toMatchObject({ body: "Treść maila", status: "approved", target: { app: "gmail" } });
    expect(repo.isSendable(s2)).toBe(true);
    // czat w aplikacji nie zamyka kroku z zatwierdzonym szkicem
    const done = await applyActions({ reply: "", actions: [{ type: "update_step", id: t2.steps[0].id, status: "done" }] }, { ai: null as never, ownerId: owner, taskId: t2.id, tasks: [(await repo.getTask(owner, t2.id))!] });
    expect(done[0].note).toContain("wysyła mostek po zatwierdzeniu");
    expect((await get(t2.id, t2.steps[0].id)).status).toBe("handoff");
    // szkic, który nie wychodzi poza Task Hub (krok Piotra): „Zatwierdź” od razu go kończy, bez biegu wysyłki; commit nie
    const t3 = await repo.createTask(owner, { title: "Notatka dla mnie", steps: [{ title: "Lista na spotkanie", tool: "manual", needsApproval: true }, { title: "Commit", tool: "code", needsApproval: true }] });
    await repo.updateStep(t3.steps[0].id, { status: "draft", blocks: [{ type: "draft", target: { app: "manual", action: "other" }, body: "1. Budżet", status: "proposed" }] });
    await repo.updateStep(t3.steps[1].id, { status: "draft", blocks: [{ type: "changes", repo: "wlrx/app", branch: "fix", files: [{ path: "a.ts" }] }, { type: "draft", target: { app: "code", action: "commit" }, body: "Fix", status: "proposed" }] });
    await actions.approveStep(t3.id, t3.steps[0].id);
    await actions.approveStep(t3.id, t3.steps[1].id);
    const s3 = await get(t3.id, t3.steps[0].id);
    expect(s3.status).toBe("done"); expect(repo.draftOf(s3)?.status).toBe("sent");
    expect(repo.isSendable(await get(t3.id, t3.steps[1].id))).toBe(true);
  });

  it("klient (OAuth, automat) i bieg pracy nie widzą zatwierdzonych szkiców i nie oznaczają ich jako wysłane; stary mostek tak", async () => {
    await sql()`delete from tasks where owner_id = ${owner}`;
    const { taskId, stepId } = await proposed("Dla klienta niewidoczne");
    await repo.approveDraft(owner, stepId);
    const c = await call(client, "list_work", { force: true });
    expect(c.text).not.toContain(stepId);
    expect(c.text).not.toContain("ZATWIERDZONE");
    const b = await call(bridge, "list_work", {});
    expect(b.text).toContain("ZATWIERDZONE SZKICE DO WYSŁANIA");
    expect(b.text).toContain(stepId);
    expect((await call(client, "get_task", { taskId })).text).toContain("wyśle go mostek Task Hub w osobnym biegu wysyłki; nie wysyłaj");
    expect((await call(bridge, "get_task", { taskId })).text).toContain("ZATWIERDZONY: wyślij dokładnie tę treść");
    expect((await call(client, "start_step", { stepId })).text).toContain("Nie zacząłem");
    const cs = await call(client, "complete_step", { stepId, summary: "wysłane" });
    expect(cs.text).toContain("osobnym biegu wysyłki");
    expect(repo.draftOf(await get(taskId, stepId))?.status).toBe("approved");
    // bieg pracy mostka v2: jak klient, bez „MOSTEK AKTYWNY”
    const run = (await repo.startBridgeRun(owner, bridgeId, "Mac", "work"))!;
    const work = await repo.createRunToken(owner, { kind: "work", runId: run.id }, 30);
    const w = await call(work, "list_work", {});
    expect(w.text).not.toContain("MOSTEK AKTYWNY");
    expect(w.text).not.toContain(stepId);
    expect((await call(work, "complete_step", { stepId, summary: "x" })).text).toContain("osobnym biegu wysyłki");
    expect((await call(work, "list_connections", { audit: true })).text).toContain("nie w biegu mostka");
    expect(await repo.endBridgeRun(owner, run.id, "done")).toBe(true);
    expect((await call(work, "list_work", {})).status).toBe(401);   // koniec biegu odbiera token
    // stary mostek zamyka szkic jako wysłany
    const sent = await call(bridge, "complete_step", { stepId, summary: "Wysłane na #dev", link: "javascript:alert(1)" });
    expect(sent.text).toContain("Krok zapisany");
    const s = await get(taskId, stepId);
    expect(s.status).toBe("done"); expect(repo.draftOf(s)?.status).toBe("sent"); expect(s.link).toBeNull();
  });

  it("token biegu wysyłki: tylko jego krok i zadanie, najwyżej jedno wzięcie, zamyka szkic jako wysłany", async () => {
    await sql()`delete from tasks where owner_id = ${owner}`;
    const a = await proposed("Wysyłka A", "Tekst A");
    const b = await proposed("Wysyłka B", "Tekst B");
    await repo.approveDraft(owner, a.stepId);
    await repo.approveDraft(owner, b.stepId);
    expect((await listSendable(owner)).map((x) => x.step.id)).toEqual([a.stepId, b.stepId]);   // najdawniej zatwierdzony pierwszy
    const run = (await repo.startBridgeRun(owner, bridgeId, "Mac", "send", a.stepId))!;
    expect(run).toMatchObject({ kind: "send", stepId: a.stepId, taskId: a.taskId });
    expect(await repo.markSendStarted(owner, a.stepId)).toBe(true);
    expect(await repo.markSendStarted(owner, a.stepId)).toBe(false);                            // drugi raz nie
    expect((await listSendable(owner)).map((x) => x.step.id)).toEqual([b.stepId]);
    const tok = await repo.createRunToken(owner, { kind: "send", runId: run.id, stepId: a.stepId, taskId: a.taskId }, 10);
    const lw = await call(tok, "list_work", {});
    expect(lw.text).toContain(a.stepId); expect(lw.text).not.toContain(b.stepId);
    expect((await call(tok, "get_task", { taskId: a.taskId })).text).toContain(`SZKIC KROKU ${a.stepId}`);
    expect((await call(tok, "get_task", { taskId: a.taskId })).text).toContain("ZATWIERDZONY: wyślij dokładnie tę treść");
    for (const [name, args] of [["get_task", { taskId: b.taskId }], ["set_blocks", { stepId: a.stepId, blocks: [draft("Inna treść")] }], ["create_task", { title: "x" }], ["complete_step", { stepId: b.stepId, summary: "x" }], ["leave_step", { stepId: b.stepId, reason: "x" }], ["start_step", { stepId: a.stepId }], ["list_connections", { audit: true }]] as const) {
      const r = await call(tok, name, args);
      expect(r.isError, name).toBe(true);
      expect(r.text, name).toContain("Ten bieg tylko wysyła jeden zatwierdzony szkic");
    }
    expect((await call(tok, "list_connections", {})).isError).toBe(false);
    expect((await call(tok, "add_facts", { stepId: a.stepId, facts: [{ label: "Kanał", value: "#dev", source: { app: "slack", url: "javascript:alert(1)" } }] })).text).toContain("Zapisano");
    expect((await repo.listFacts({ stepId: a.stepId }))[0].source).toEqual({ app: "slack" });   // adres spoza http(s) wypadł
    const done = await call(tok, "complete_step", { stepId: a.stepId, summary: "Wysłane", link: "https://slack.com/archives/C1/p1" });
    expect(done.text).toContain("Krok zapisany");
    const s = await get(a.taskId, a.stepId);
    expect(s.status).toBe("done"); expect(repo.draftOf(s)?.status).toBe("sent"); expect(s.link).toBe("https://slack.com/archives/C1/p1");
    await repo.endBridgeRun(owner, run.id, "done");
    expect((await call(tok, "list_work", {})).status).toBe(401);
    expect(repo.isSendable(await get(b.taskId, b.stepId))).toBe(true);                            // B czeka na swój bieg
  });

  it("token biegu: wygasły nie działa, lista tokenów go nie pokazuje, punkty mostka go nie przyjmują", async () => {
    const run = (await repo.startBridgeRun(owner, bridgeId, "Mac", "work"))!;
    const tok = await repo.createRunToken(owner, { kind: "work", runId: run.id }, 30);
    const auth = await repo.tokenForSecret(tok);
    expect(auth).toMatchObject({ kind: "run", ownerId: owner, scope: { kind: "work", runId: run.id } });
    await sql()`update api_tokens set seen_at = now() - interval '1 hour' where id = ${bridgeId}`;
    await repo.tokenForSecret(tok);
    expect((await repo.bridgeStatus(owner, 120_000)).alive).toBe(true);                         // użycie tokenu biegu to puls mostka
    expect((await repo.listApiTokens(owner)).some((t) => t.kind === "run")).toBe(false);
    const viaBridge = await authBridge(new Request("http://x/api/bridge/work", { headers: { authorization: `Bearer ${tok}` } }));
    expect(viaBridge instanceof Response && viaBridge.status).toBe(401);
    await sql()`update api_tokens set expires_at = now() - interval '1 minute' where id = ${auth!.id}`;
    expect(await repo.tokenForSecret(tok)).toBeNull();
    expect((await call(tok, "list_work", {})).status).toBe(401);
    await repo.endBridgeRun(owner, run.id, "done");
    expect((await sql()`select 1 from api_tokens where id = ${auth!.id}`).length).toBe(0);
  });

  it("bieg wysyłki bez potwierdzenia cofa zgodę z notatką; wysyłka potwierdzona przez mostek zamyka krok", async () => {
    await sql()`delete from tasks where owner_id = ${owner}`;
    const a = await proposed("Bez potwierdzenia");
    await repo.approveDraft(owner, a.stepId);
    const r1 = (await repo.startBridgeRun(owner, bridgeId, "Mac", "send", a.stepId))!;
    await repo.markSendStarted(owner, a.stepId);
    expect(repo.isSendable(await get(a.taskId, a.stepId))).toBe(false);                           // w trakcie wysyłki nikt inny go nie weźmie
    await repo.endBridgeRun(owner, r1.id, "stopped");
    let s = await get(a.taskId, a.stepId);
    expect(s).toMatchObject({ status: "draft", approvedAt: null, sendStartedAt: null });
    expect(repo.draftOf(s)?.status).toBe("proposed");
    const chat = await repo.listChat(owner, a.taskId);
    expect(chat.at(-1)?.text).toBe("Wysyłka nie została potwierdzona. Sprawdź w Slack, czy poszło, i zatwierdź ponownie, jeśli trzeba.");
    expect(await repo.clearApproval(owner, a.stepId, { note: "drugi raz" })).toBe(false);           // nic do cofnięcia: bez drugiej notatki
    // commit zrobiony przez aplikację na Macu: krok zrobiony, szkic wysłany
    await repo.approveDraft(owner, a.stepId);
    expect(await repo.completeSend(owner, a.stepId, { summary: "commit abc1234 na main" })).toBe(false);   // bez wzięcia przez bieg wysyłki nie
    const r2 = (await repo.startBridgeRun(owner, bridgeId, "Mac", "send", a.stepId))!;
    await repo.markSendStarted(owner, a.stepId);
    expect(await repo.completeSend(owner, a.stepId, { summary: "commit abc1234 na main", link: "https://github.com/o/r/commit/abc1234" })).toBe(true);
    await repo.endBridgeRun(owner, r2.id, "done");
    s = await get(a.taskId, a.stepId);
    expect(s).toMatchObject({ status: "done", report: "commit abc1234 na main", link: "https://github.com/o/r/commit/abc1234" });
    expect(repo.draftOf(s)?.status).toBe("sent");
    expect((await repo.listChat(owner, a.taskId)).at(-1)?.text).toContain("Wysłałem na Slacku:");
  });

  it("agent podnosi „wymaga zgody” dla szkicu do aplikacji zewnętrznej; linki kroków tylko http(s)", async () => {
    const r = await call(client, "create_task", { title: "Linki", steps: [{ title: "Napisz do Ani", tool: "slack", link: "javascript:alert(1)" }, { title: "Zobacz", tool: "manual", link: "https://ok.pl/x" }] });
    const { taskId, steps } = JSON.parse(r.text) as { taskId: string; steps: { id: string }[] };
    let t = (await repo.getTask(owner, taskId))!;
    expect(t.steps.map((s) => s.link)).toEqual([null, "https://ok.pl/x"]);
    await repo.addSteps(taskId, [{ title: "Plik", link: "file:///etc/passwd" }]);
    expect((await repo.getTask(owner, taskId))!.steps.at(-1)?.link).toBeNull();
    await call(client, "set_blocks", { stepId: steps[0].id, blocks: [draft("Hej Ania")] });
    t = (await repo.getTask(owner, taskId))!;
    expect(t.steps[0]).toMatchObject({ status: "draft", needsApproval: true });
  });

  it("stare zgody bez podpisu wracają do zatwierdzenia (migracja 0018)", async () => {
    const t = await repo.createTask(owner, { title: "Stara zgoda", steps: [{ title: "a", tool: "slack" }, { title: "b", tool: "gmail" }, { title: "c", tool: "slack" }] });
    const [a, b, c] = t.steps.map((s) => s.id);
    await sql()`update steps set status = 'handoff', prev_status = 'draft', blocks = ${sql().json([{ type: "text", body: "k" }, draft("x", "approved")] as never)} where id = ${a}`;
    await sql()`update steps set status = 'handoff', prev_status = 'draft', output = 'stara treść' where id = ${b}`;
    await sql()`update steps set status = 'done', blocks = ${sql().json([draft("y", "sent")] as never)} where id = ${c}`;
    await sql().unsafe(readFileSync(path.join(process.cwd(), "supabase/migrations/0018_stage0.sql"), "utf8"));
    const s = (await repo.getTask(owner, t.id))!.steps;
    expect(s[0]).toMatchObject({ status: "draft", prevStatus: null });
    expect(s[0].blocks?.map((x) => x.type === "draft" ? x.status : x.type)).toEqual(["text", "proposed"]);
    expect(s[1]).toMatchObject({ status: "draft", prevStatus: null });
    expect(s[2].status).toBe("done"); expect(repo.draftOf(s[2])?.status).toBe("sent");
  });
});
