// Dobór modelu i wysiłku do kroku (zasada „Dobór modelu i wysiłku”): poziom kroku → model i wysiłek z ustawień, wybór Piotra, eskalacja,
// bieg mostka na jednej grupie pracy, limit modelu → zapasowy do końca limitu, potem powrót; „ostatnio: model · wysiłek” na kroku.
// Część z bazą pomijana bez TEST_DATABASE_URL.
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { activeLimits, choiceOf, modelConfig, modelLabel, normalizeLevel, pickRun, resetFromText, runLabel, stepLevel, type ModelConfig } from "@/lib/agent/models";

const MODELS = {
  choices: ["fable", "opus", "sonnet", "haiku"],
  levels: {
    strategy: { model: "opus", effort: "high", fallback: "fable" },
    analysis: { model: "opus", effort: "medium", fallback: "sonnet" },
    execution: { model: "sonnet", effort: "medium", fallback: "opus" },
    mechanics: { model: "haiku", effort: "low", fallback: "sonnet" },
  },
};
const cfg = modelConfig({ models: MODELS }) as ModelConfig;
const st = (p: { tool?: string; needsApproval?: boolean; workLevel?: string | null; modelPick?: string | null; escalation?: number } = {}) => ({ tool: "code", needsApproval: false, ...p });

describe("dobór modelu: reguły", () => {
  it("konfiguracja z ustawień; brak albo zły wpis = bez doboru", () => {
    expect(cfg.levels.execution).toEqual({ model: "sonnet", effort: "medium", fallback: "opus" });
    expect(modelConfig({})).toBeNull();
    expect(modelConfig({ models: { ...MODELS, levels: { ...MODELS.levels, mechanics: { model: "haiku", effort: "turbo" } } } })).toBeNull();
    expect(modelConfig({ models: { ...MODELS, levels: { ...MODELS.levels, analysis: { model: "opus; rm -rf", effort: "low" } } } })).toBeNull();
  });
  it("poziom: z narzędzia, z pola kroku (także po polsku), eskalacja, ważność 5, decyzja Piotra co najmniej Analiza", () => {
    expect(stepLevel(st())).toBe("execution");
    expect(stepLevel(st({ tool: "slack" }))).toBe("analysis");
    expect(normalizeLevel("Mechanika")).toBe("mechanics");
    expect(stepLevel(st({ workLevel: "mechanics" }))).toBe("mechanics");
    expect(stepLevel(st({ workLevel: "execution", escalation: 1 }))).toBe("analysis");
    expect(stepLevel(st({ workLevel: "execution", escalation: 9 }))).toBe("strategy");   // najwyżej 2 poziomy
    expect(stepLevel(st({ workLevel: "analysis" }), { weight: 5 })).toBe("strategy");
    expect(stepLevel(st({ workLevel: "strategy" }), { weight: 5 })).toBe("strategy");
    // szkic do zatwierdzenia (poza commitem) i kartka Piotra: co najmniej Analiza; commit kodu zostaje na Wykonaniu
    expect(stepLevel(st({ tool: "slack", workLevel: "mechanics", needsApproval: true }))).toBe("analysis");
    expect(stepLevel(st({ tool: "manual", workLevel: "execution" }))).toBe("analysis");
    expect(stepLevel(st({ tool: "code", needsApproval: true }))).toBe("execution");
  });
  it("wybór Piotra: jego model z wysiłkiem poziomu; zapasowy to model poziomu", () => {
    expect(choiceOf(cfg, "execution")).toMatchObject({ model: "sonnet", effort: "medium", fallback: "opus", picked: false, key: "sonnet|medium" });
    expect(choiceOf(cfg, "execution", "fable")).toMatchObject({ model: "fable", effort: "medium", fallback: "sonnet", picked: true, key: "fable|medium" });
    expect(choiceOf(cfg, "execution", "sonnet")).toMatchObject({ model: "sonnet", fallback: "opus" });
  });
  it("limit: zapasowy do końca limitu, potem główny; wszystko w limicie = najbliższa godzina powrotu", () => {
    const now = Date.now(), soon = new Date(now + 3600_000).toISOString(), later = new Date(now + 7200_000).toISOString(), past = new Date(now - 60_000).toISOString();
    const strat = choiceOf(cfg, "strategy"), exec = choiceOf(cfg, "execution");
    expect(activeLimits({ opus: soon, fable: past })).toEqual({ opus: soon });
    expect(pickRun([strat, exec], {})).toMatchObject({ model: "opus", limited: null });
    expect(pickRun([strat, exec], activeLimits({ opus: soon, fable: past }))).toMatchObject({ model: "fable", limited: { model: "opus", until: soon } });
    // główny i zapasowy strategii w limicie: bieg bierze następną grupę
    expect(pickRun([strat, exec], { opus: soon, fable: later })).toMatchObject({ choice: { key: "sonnet|medium" }, model: "sonnet" });
    expect(pickRun([strat], { opus: soon, fable: later })).toEqual({ blockedUntil: later });
    expect(pickRun([], {})).toBeNull();
  });
  it("nazwy dla człowieka i koniec limitu z komunikatu", () => {
    expect(modelLabel("claude-sonnet-5-5")).toBe("Sonnet 5.5");
    expect(modelLabel("claude-opus-5-5[1m]")).toBe("Opus 5.5");
    expect(modelLabel("fable")).toBe("Fable");
    expect(runLabel("opus", "high")).toBe("Opus · wysoki");
    expect(resetFromText("You've reached your Fable limit|1760630400")).toBe(new Date(1760630400 * 1000).toISOString());
    expect(resetFromText("bez godziny")).toBeNull();
  });
});

vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));
vi.mock("@/lib/session", async (orig) => ({ ...(await orig<typeof import("@/lib/session")>()), requireOwner: async () => (await import("@/lib/repo")).ensureOwner() }));

describe.skipIf(!process.env.TEST_DATABASE_URL)("dobór modelu: mostek i konektor", async () => {
  const repo = await import("@/lib/repo");
  const { sql } = await import("@/lib/db");
  const run = await import("@/app/api/bridge/run/route");
  const runId = await import("@/app/api/bridge/run/[id]/route");
  const mcp = await import("@/app/api/mcp/route");
  const actions = await import("@/app/actions");
  let owner = "", tok = "";
  const H = (t: string) => ({ Authorization: `Bearer ${t}` });
  const call = async (t: string, name: string, args: Record<string, unknown>) => {
    const r = await mcp.POST(new Request("http://x/api/mcp", { method: "POST", headers: { authorization: `Bearer ${t}`, "content-type": "application/json", accept: "application/json, text/event-stream" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }) }));
    const msgs = (await r.text()).split("\n").filter((l) => l.startsWith("data: ")).map((l) => JSON.parse(l.slice(6)));
    const m = msgs.find((x) => x.id === 1);
    return ((m?.result?.content ?? []) as { text?: string }[]).map((c) => c.text ?? "").join("\n") + (m?.error ? m.error.message : "");
  };
  const postRun = async () => run.POST(new Request("http://x/api/bridge/run", { method: "POST", headers: H(tok), body: JSON.stringify({ bridge: "mini", v: 2, kind: "work" }) }));
  const patch = async (id: string, body: Record<string, unknown>) => runId.PATCH(new Request("http://x/api/bridge/run/x", { method: "PATCH", headers: H(tok), body: JSON.stringify(body) }), { params: Promise.resolve({ id }) });
  const closeOpen = async () => { const open = (await repo.bridgeStatus(owner, 0)).run; if (open) await repo.endBridgeRun(owner, open.id, "done"); };
  const limits = async () => ((await repo.userSettings(owner)).modelLimits ?? {}) as Record<string, string>;

  beforeAll(async () => {
    owner = (await repo.ensureOwner()).id;
    await sql()`delete from tasks where owner_id = ${owner}`;
    await sql()`delete from bridge_runs where owner_id = ${owner}`;
    await sql()`delete from api_tokens where owner_id = ${owner}`;
    await sql()`delete from chat_messages where owner_id = ${owner}`;
    await repo.setUserSettings(owner, { models: MODELS, modelLimits: {} });
    tok = await repo.createApiToken(owner, "mini", "bridge");
  });
  afterAll(async () => {
    await repo.setUserSettings(owner, { modelLimits: {} });
    await sql().end({ timeout: 2 });
  });

  it("bieg bierze grupę pierwszej pozycji (rozpisanie = Strategia), list_work biegu pokazuje tylko ją; limit przełącza na zapasowy, potem na następną grupę", async () => {
    const code = await repo.createTask(owner, { title: "Poprawka", steps: [{ title: "Popraw błąd", tool: "code", workLevel: "execution" }] });
    const fresh = await repo.createTask(owner, { title: "Nowa funkcja" });
    let b = await (await postRun()).json();
    expect(b).toMatchObject({ model: "opus", effort: "high", fallbackModel: "fable", level: "strategy", modelLabel: "Opus · wysoki" });
    const lw = await call(b.token, "list_work", {});
    expect(lw).toContain("TEN BIEG: Opus · wysoki");
    expect(lw).toContain(fresh.id);
    expect(lw).not.toContain(code.steps[0].id);
    expect(lw).toContain("Pozostałe (1)");
    // Claude Code zgłasza model z init; limit z godziną z komunikatu
    expect((await patch(b.run.id, { model: "claude-opus-5-5" })).status).toBe(200);
    expect((await repo.getBridgeRun(owner, b.run.id))?.modelUsed).toBe("claude-opus-5-5");
    const reset = Math.floor(Date.now() / 1000) + 3600;
    await patch(b.run.id, { outcome: "limit", note: `You've reached your Opus limit|${reset}` });
    expect((await limits()).opus).toBe(new Date(reset * 1000).toISOString());
    // następny bieg: ta sama grupa na zapasowym, bez dalszego przełączania w trakcie
    b = await (await postRun()).json();
    expect(b).toMatchObject({ model: "fable", effort: "high", fallbackModel: "", level: "strategy" });
    expect(b.modelLabel).toMatch(/^limit Opus do \d\d:\d\d, pracuję na Fable$/);
    expect(await call(b.token, "list_work", {})).toContain(fresh.id);
    await patch(b.run.id, { outcome: "limit", note: "limit", until: new Date(Date.now() + 7200_000).toISOString() });
    // Opus i Fable w limicie: Strategia czeka, bieg bierze Wykonanie
    b = await (await postRun()).json();
    expect(b).toMatchObject({ model: "sonnet", effort: "medium", level: "execution" });
    const lw2 = await call(b.token, "list_work", {});
    expect(lw2).toContain(code.steps[0].id);
    expect(lw2).not.toContain(fresh.id);
    await patch(b.run.id, { outcome: "limit", note: "limit" });   // bez godziny: 30 minut
    // wszystko w limicie: 429 z najbliższą godziną powrotu, bieg nie rusza
    const r = await postRun();
    expect(r.status).toBe(429);
    const j = await r.json();
    expect(j.limit).toBe(true);
    expect(Date.parse(j.until)).toBeGreaterThan(Date.now());
    expect((await repo.bridgeStatus(owner, 0)).run).toBeNull();
    // koniec limitu (minął): biegi same wracają na model główny
    await repo.setUserSettings(owner, { modelLimits: { opus: new Date(Date.now() - 1000).toISOString() } });
    b = await (await postRun()).json();
    expect(b.model).toBe("opus");
    await closeOpen();
    await sql()`delete from tasks where id in (${code.id}, ${fresh.id})`;
  });

  it("poziom z add_steps (po polsku), oddany krok idzie poziom wyżej, wybór Piotra na karcie, „ostatnio: model · wysiłek” po biegu", async () => {
    const t = await repo.createTask(owner, { title: "Zadanie z krokami", steps: [{ title: "Pierwszy", tool: "code" }] });
    let b = await (await postRun()).json();
    expect(b).toMatchObject({ model: "sonnet", level: "execution" });
    expect(await call(b.token, "add_steps", { taskId: t.id, steps: [{ title: "Wyślij status", tool: "claude", workLevel: "Mechanika" }] })).toContain("Wyślij status");
    const added = (await repo.getTask(owner, t.id))!.steps.find((s) => s.title === "Wyślij status")!;
    expect(added.workLevel).toBe("mechanics");
    expect(await call(b.token, "update_step", { stepId: added.id, workLevel: "bardzo trudne" })).toContain("Nieznany poziom");
    const first = t.steps[0].id;
    expect(await call(b.token, "start_step", { stepId: first })).toBe("Krok w toku.");
    await patch(b.run.id, { model: "claude-sonnet-5-5" });
    expect(await call(b.token, "leave_step", { stepId: first, reason: "nie rozumiem opisu" })).toBe("Krok oddany.");
    expect((await repo.getTask(owner, t.id))!.steps.find((s) => s.id === first)!.escalation).toBe(1);
    await patch(b.run.id, { outcome: "done", note: "ok" });
    const after = (await repo.getTask(owner, t.id))!.steps.find((s) => s.id === first)!;
    expect(after.lastRun).toMatchObject({ model: "claude-sonnet-5-5", effort: "medium" });
    // po eskalacji krok z kodem idzie na Analizie (Opus · średni), przed Mechaniką
    b = await (await postRun()).json();
    expect(b).toMatchObject({ model: "opus", effort: "medium", level: "analysis" });
    await closeOpen();
    // Piotr wybiera model na karcie: bieg dostaje jego model z wysiłkiem poziomu; zły wpis = auto
    await actions.patchStep(t.id, first, { modelPick: "fable" });
    b = await (await postRun()).json();
    expect(b).toMatchObject({ model: "fable", effort: "medium", fallbackModel: "opus" });
    await closeOpen();
    await actions.patchStep(t.id, first, { modelPick: "x; rm" });
    expect((await repo.getTask(owner, t.id))!.steps.find((s) => s.id === first)!.modelPick).toBeNull();
    // ustawienia: zmiana jednego poziomu, zapasowy taki sam jak główny = bez zapasowego
    await actions.saveModelLevel("Wykonanie", { model: "haiku", fallback: "haiku" });
    expect(modelConfig(await repo.userSettings(owner))!.levels.execution).toEqual({ model: "haiku", effort: "medium", fallback: "" });
    await repo.setUserSettings(owner, { models: MODELS });
  });

  it("bieg wysyłki: Mechanika (Haiku · niski), a wybór Piotra na karcie szkicu (Sonnet) wygrywa", async () => {
    // własny konektor Slack na tym Macu: bez niego wynik zależał od połączeń zostawionych przez inne pliki testów
    await repo.upsertBridgeConnections(owner, "mini", [{ name: "claude.ai Slack", ok: true }]);
    const t = await repo.createTask(owner, { title: "Wysyłka", steps: [{ title: "Napisz na #dev", tool: "slack", needsApproval: true }] });
    const id = t.steps[0].id;
    await repo.updateStep(id, { status: "draft", blocks: [{ type: "draft", status: "proposed", body: "Cześć", target: { app: "slack", action: "send", where: "#dev" } } as never] });
    const send = async () => run.POST(new Request("http://x/api/bridge/run", { method: "POST", headers: H(tok), body: JSON.stringify({ bridge: "mini", v: 2, kind: "send" }) }));
    expect(await repo.approveDraft(owner, id)).toBe(true);
    let b = await (await send()).json();
    expect(b).toMatchObject({ kind: "send", step: { id }, model: "haiku", effort: "low" });
    await patch(b.run.id, { outcome: "stopped" });
    await actions.patchStep(t.id, id, { modelPick: "sonnet" });
    expect(await repo.approveDraft(owner, id)).toBe(true);
    b = await (await send()).json();
    expect(b).toMatchObject({ kind: "send", step: { id }, model: "sonnet", effort: "low", fallbackModel: "haiku" });
    await closeOpen();
    await sql()`delete from tasks where id = ${t.id}`;
  });

  it("bez doboru w ustawieniach bieg idzie jak dotąd: bez modelu, list_work bez nagłówka", async () => {
    await repo.setUserSettings(owner, { models: null });
    const b = await (await postRun()).json();
    expect(b.model).toBeUndefined();
    expect(await call(b.token, "list_work", {})).not.toContain("TEN BIEG");
    await closeOpen();
    await repo.setUserSettings(owner, { models: MODELS });
  });
});
