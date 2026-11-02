// Przełącznik Claude | GPT (paczka 40, zadanie „Podłączenie GPT Codex do Task Hub”): pigułka „Agent” kieruje pracę mostka do Codex,
// gdy Mac zgłasza Codex gotowy; kroki z aplikacjami z konta Claude, kodem i plikami zostają przy Claude; limit GPT nie blokuje Claude'a.
// Część z bazą pomijana bez TEST_DATABASE_URL.
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { codexEffort, codexStateOf, gptCanStep, gptChoice, gptModelOf, runnerOf } from "@/lib/agent/runner";
import { modelLabel, runLabel, choiceOf, modelConfig, type ModelConfig } from "@/lib/agent/models";
import { codexWorkPrompt } from "@/lib/bridge";

const MODELS = {
  choices: ["fable", "opus", "sonnet", "haiku"],
  levels: {
    strategy: { model: "opus", effort: "high", fallback: "fable" },
    analysis: { model: "opus", effort: "medium", fallback: "sonnet" },
    execution: { model: "sonnet", effort: "medium", fallback: "opus" },
    mechanics: { model: "haiku", effort: "low", fallback: "sonnet" },
  },
};

describe("przełącznik Claude | GPT: reguły", () => {
  it("ustawienia: domyślnie Claude, model GPT jako dane, stan Codex z pulsu mostka", () => {
    expect(runnerOf({})).toBe("claude");
    expect(runnerOf({ agentRunner: "gpt" })).toBe("gpt");
    expect(runnerOf({ agentRunner: "x" })).toBe("claude");
    expect(gptModelOf({ gptModel: " gpt-5.5-codex " })).toBe("gpt-5.5-codex");
    expect(gptModelOf({ gptModel: "zły; model" })).toBe("");
    expect(codexStateOf({ codex: "ready" })).toBe("ready");
    expect(codexStateOf({})).toBe("unknown");
  });
  it("Codex robi dokument i research; aplikacje z konta Claude, kod, plik i model wybrany na karcie zostają przy Claude", () => {
    expect(gptCanStep({ tool: "claude" })).toBe(true);
    expect(gptCanStep({ tool: "browser" })).toBe(true);
    for (const tool of ["slack", "gmail", "clickup", "code", "file", "figma", "calendar"]) expect(gptCanStep({ tool })).toBe(false);
    expect(gptCanStep({ tool: "claude", modelPick: "sonnet" })).toBe(false);
  });
  it("grupa GPT: wysiłek z poziomu, bez zapasowego, osobny klucz i nazwa dla człowieka", () => {
    const cfg = modelConfig({ models: MODELS }) as ModelConfig;
    const c = gptChoice(choiceOf(cfg, "strategy"), "");
    expect(c).toMatchObject({ model: "gpt:", effort: "high", fallback: "", runner: "gpt", key: "gpt:|high" });
    expect(gptChoice(null, "gpt-5.5")).toMatchObject({ model: "gpt:gpt-5.5", effort: "medium", level: "analysis" });
    expect(modelLabel("gpt:")).toBe("GPT");
    expect(runLabel("gpt:gpt-5.5", "high")).toBe("GPT gpt-5.5 · wysoki");
    expect(codexEffort("xhigh")).toBe("high");
    expect(codexEffort("low")).toBe("low");
  });
  it("prompt Codex: tylko konektor Task Hub, bez kodu i plików, wysyłka zawsze jako szkic", () => {
    const p = codexWorkPrompt();
    expect(p).toContain("serwer MCP Task Hub");
    expect(p).toContain("list_work");
    expect(p).not.toContain("KROK Z KODEM");
    expect(p).toContain("szkic do zatwierdzenia");
  });
});

vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));
vi.mock("@/lib/session", async (orig) => ({ ...(await orig<typeof import("@/lib/session")>()), requireOwner: async () => (await import("@/lib/repo")).ensureOwner() }));

describe.skipIf(!process.env.TEST_DATABASE_URL)("przełącznik Claude | GPT: mostek i konektor", async () => {
  const repo = await import("@/lib/repo");
  const { sql } = await import("@/lib/db");
  const run = await import("@/app/api/bridge/run/route");
  const runId = await import("@/app/api/bridge/run/[id]/route");
  const work = await import("@/app/api/bridge/work/route");
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
  const pulse = async (codex: string) => work.GET(new Request(`http://x/api/bridge/work?host=mini&runner=claude&state=idle&v=2&codex=${codex}`, { headers: H(tok) }));
  const postRun = async () => run.POST(new Request("http://x/api/bridge/run", { method: "POST", headers: H(tok), body: JSON.stringify({ bridge: "mini", v: 2, kind: "work" }) }));
  const patch = async (id: string, body: Record<string, unknown>) => runId.PATCH(new Request("http://x/api/bridge/run/x", { method: "PATCH", headers: H(tok), body: JSON.stringify(body) }), { params: Promise.resolve({ id }) });
  const closeOpen = async () => { const open = (await repo.bridgeStatus(owner, 0)).run; if (open) await repo.endBridgeRun(owner, open.id, "done"); };

  beforeAll(async () => {
    owner = (await repo.ensureOwner()).id;
    await sql()`delete from tasks where owner_id = ${owner}`;
    await sql()`delete from bridge_runs where owner_id = ${owner}`;
    await sql()`delete from api_tokens where owner_id = ${owner}`;
    await sql()`delete from chat_messages where owner_id = ${owner}`;
    await repo.setUserSettings(owner, { models: MODELS, modelLimits: {}, agentRunner: null, gptModel: null });
    tok = await repo.createApiToken(owner, "mini", "bridge");
  });
  afterAll(async () => {
    await repo.setUserSettings(owner, { modelLimits: {}, agentRunner: null, gptModel: null });
    await sql().end({ timeout: 2 });
  });

  it("GPT w pigułce + Codex gotowy: rozpisanie i dokument idą do Codex, krok ze Slackiem do Claude'a; Codex niegotowy = wszystko Claude", async () => {
    const fresh = await repo.createTask(owner, { title: "Nowy pomysł" });
    const mixed = await repo.createTask(owner, { title: "Raport", steps: [{ title: "Przeczytaj wątek", tool: "slack", workLevel: "analysis" }] });
    await actions.setAgentRunner("gpt");
    expect(runnerOf(await repo.userSettings(owner))).toBe("gpt");

    // Mac bez Codex: przełącznik nic nie zmienia, pracuje Claude
    expect((await pulse("missing")).status).toBe(200);
    let b = await (await postRun()).json();
    expect(b).toMatchObject({ runner: "claude", model: "opus", level: "strategy" });
    await closeOpen();

    // Codex gotowy: rozpisanie (Strategia) w Codex, z tokenem biegu, blokadą narzędzi chmury i wysiłkiem z poziomu
    await repo.setUserSettings(owner, { gptModel: "gpt-5.5-codex" });
    await pulse("ready");
    b = await (await postRun()).json();
    expect(b).toMatchObject({ runner: "codex", model: "gpt-5.5-codex", effort: "high", fallbackModel: "", level: "strategy", modelLabel: "GPT gpt-5.5-codex · wysoki" });
    expect(b.disabledTools).toContain("cloud_work");
    expect(b.prompt).toContain("Codex");
    expect(b.token).toBeTruthy();
    const lw = await call(b.token, "list_work", {});
    expect(lw).toContain("TEN BIEG: GPT gpt-5.5-codex · wysoki");
    expect(lw).toContain(fresh.id);
    expect(lw).not.toContain(mixed.steps[0].id);
    expect((await repo.getBridgeRun(owner, b.run.id))?.model).toBe("gpt:gpt-5.5-codex");

    // limit GPT: zapisany pod modelem GPT, więc Claude bierze swój krok ze Slackiem, a rozpisanie czeka na koniec limitu GPT
    await patch(b.run.id, { outcome: "limit", note: "You've hit your usage limit." });
    const lim = ((await repo.userSettings(owner)).modelLimits ?? {}) as Record<string, string>;
    expect(Object.keys(lim)).toContain("gpt:gpt-5.5-codex");
    b = await (await postRun()).json();
    expect(b).toMatchObject({ runner: "claude", model: "opus", level: "analysis" });
    const lw2 = await call(b.token, "list_work", {});
    expect(lw2).toContain(mixed.steps[0].id);
    expect(lw2).not.toContain(fresh.id);
    await closeOpen();

    // powrót na Claude: jedno kliknięcie, bez logowania; rozpisanie znowu u Claude'a
    await repo.setUserSettings(owner, { modelLimits: {} });
    await actions.setAgentRunner("claude");
    b = await (await postRun()).json();
    expect(b).toMatchObject({ runner: "claude", level: "strategy" });
    await closeOpen();
    await sql()`delete from tasks where id in (${fresh.id}, ${mixed.id})`;
  });
});
