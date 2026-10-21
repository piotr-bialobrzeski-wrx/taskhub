// Paczka 8, punkt 1: projekt z treści zadania. Nazwa projektu w tytule, celu albo źródle (także odmieniona, także po „projekt …”)
// daje projekt już przy przyjęciu zadania; agent dostaje zasadę w liście pracy; konektor nie tworzy projektów z nieznanych nazw.
import { describe, it, expect, beforeAll, vi } from "vitest";
import { guessProject, nameForms } from "@/lib/project-guess";
import { PROJECT_RULE } from "@/lib/agent/work";
import { brief } from "@/lib/agent/context";
import { project, task } from "./helpers";

vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));
vi.mock("@/lib/session", async (orig) => ({ ...(await orig<typeof import("@/lib/session")>()), requireOwner: async () => (await import("@/lib/repo")).ensureOwner() }));

const P = [
  project({ id: "sh", name: "Shiftwow" }), project({ id: "cc", name: "Custom Cookies" }), project({ id: "os", name: "PirxeyOS" }),
  project({ id: "call", name: "Call Companion (hackathon Pirxey)" }), project({ id: "pw", name: "Pirxey & Widelab" }),
  project({ id: "th", name: "Task Hub" }), project({ id: "sl", name: "Shattered Lands" }), project({ id: "vel", name: "Veloza" }), project({ id: "ab", name: "AB" }),
];
const g = (t: string) => guessProject(t, P)?.id ?? null;

describe("projekt z treści (guessProject)", () => {
  it("wiadomość Piotra ze zrzutu: „z projektu Shiftwow” daje Shiftwow", () => {
    expect(g("Stwórz zadanie, a w nim wybierz tickety z Clickup, z projektu Shiftwow, które mają któryś z wymienionych statusów (BA&UX TODO, Ready for dev)")).toBe("sh");
  });
  it("odmiana i wielkość liter: „w Task Hubie”, „SHIFTWOW”, „dla Velozy”, „Shiftwowa”, „Shiftwowie”", () => {
    expect(g("Poprawka w Task Hubie: kafelek")).toBe("th");
    expect(g("tickety SHIFTWOW do przejrzenia")).toBe("sh");
    expect(g("oferta dla Velozy")).toBe("vel");
    expect(g("retro Shiftwowa")).toBe("sh");
    expect(g("spotkanie o Shiftwowie")).toBe("sh");
  });
  it("granice słowa: „Shiftwowski” ani „Hubert” to nie projekt; nazwy krótsze niż 3 znaki pomijane", () => {
    expect(g("styl Shiftwowski")).toBeNull();
    expect(g("Hubert dzwonił")).toBeNull();
    expect(g("spotkanie AB i ABu")).toBeNull();
    expect(g("zwykłe zadanie bez nazw")).toBeNull();
    expect(g("")).toBeNull();
  });
  it("kilka nazw: fraza „projekt …” wygrywa, inaczej wcześniejsza wzmianka; dłuższa nazwa w tym samym miejscu", () => {
    expect(g("Custom Cookies i Shiftwow: wspólny status")).toBe("cc");
    expect(g("Custom Cookies: ticket w projekcie Shiftwow")).toBe("sh");
    expect(g("Pirxey & Widelab: nowy cennik")).toBe("pw");
  });
  it("nazwa z nawiasem pasuje też bez nawiasu; spacje w nazwie to dowolne białe znaki", () => {
    expect(nameForms("Call Companion (hackathon Pirxey)")).toEqual(["Call Companion (hackathon Pirxey)", "Call Companion"]);
    expect(g("demo Call Companion na piątek")).toBe("call");
    expect(g("Shattered  Lands: mapa")).toBe("sl");
  });
  it("zasada dla agenta jest w liście pracy, a zadanie bez projektu jest tak opisane", () => {
    expect(PROJECT_RULE).toContain("update_task(project = dokładna nazwa z listy)");
    expect(PROJECT_RULE).toContain("nie twórz nowych projektów");
    const t = task({ projectId: null });
    expect(brief({ task: t, score: { eff: 3, parts: [] } as never, project: null })).toContain("| bez projektu");
    expect(brief({ task: t, score: { eff: 3, parts: [] } as never, project: project({ name: "Shiftwow" }) })).toContain("| projekt: Shiftwow");
  });
});

describe.skipIf(!process.env.TEST_DATABASE_URL)("projekt z treści w bazie i w konektorze", async () => {
  const repo = await import("@/lib/repo");
  const { sql } = await import("@/lib/db");
  const mcp = await import("@/app/api/mcp/route");
  let owner = "", client = "", shift = "";
  const call = async (tok: string, name: string, args: Record<string, unknown>) => {
    const r = await mcp.POST(new Request("http://x/api/mcp", { method: "POST", headers: { authorization: `Bearer ${tok}`, "content-type": "application/json", accept: "application/json, text/event-stream" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }) }));
    const msgs = (await r.text()).split("\n").filter((l) => l.startsWith("data: ")).map((l) => JSON.parse(l.slice(6)));
    const m = msgs.find((x) => x.id === 1);
    return ((m?.result?.content ?? []) as { text?: string }[]).map((c) => c.text ?? "").join("\n") + (m?.error ? m.error.message : "");
  };
  beforeAll(async () => {
    owner = (await repo.ensureOwner()).id;
    await sql()`delete from tasks where owner_id = ${owner}`;
    await sql()`delete from projects where owner_id = ${owner}`;
    await sql()`delete from api_tokens where owner_id = ${owner}`;
    shift = (await repo.createProject(owner, "Shiftwow")).id;
    await repo.createProject(owner, "Task Hub");
    client = await repo.createApiToken(owner, "Claude", "client");
  });
  it("createTask bez projektu bierze go z treści (dok, szybkie zadanie z Maca, konektor), a podany projekt zostaje", async () => {
    const a = await repo.createTask(owner, { title: "Stwórz zadanie, a w nim wybierz tickety z Clickup, z projektu Shiftwow, które mają status BA&UX TODO", source: "…" });
    expect(a.projectId).toBe(shift);
    const b = await repo.createTask(owner, { title: "Zadanie bez nazw", source: "nic" });
    expect(b.projectId).toBeNull();
    const c = await repo.createTask(owner, { title: "Z celu", summary: "porządki w Task Hubie" });
    expect(c.projectId).toBe((await repo.findProjectByName(owner, "Task Hub"))!.id);
    const d = await repo.createTask(owner, { title: "Shiftwow, ale wskazany Task Hub", projectId: c.projectId });
    expect(d.projectId).toBe(c.projectId);
  });
  it("konektor: create_task bez project bierze projekt z treści; nieznana nazwa to błąd z listą, bez nowego projektu; odmieniona nazwa pasuje", async () => {
    const made = await call(client, "create_task", { title: "Retro Shiftwow", summary: "tematy" });
    const id = (JSON.parse(made) as { taskId: string }).taskId;
    expect((await repo.getTask(owner, id))!.projectId).toBe(shift);
    const bad = await call(client, "update_task", { taskId: id, project: "Shift Wow" });
    expect(bad).toContain("Nie ma projektu „Shift Wow”");
    expect(bad).toContain("Shiftwow, Task Hub");
    expect((await repo.listProjects(owner)).map((p) => p.name).sort()).toEqual(["Shiftwow", "Task Hub"]);
    expect(await call(client, "update_task", { taskId: id, project: "Task Hubie" })).toBe("Zmieniono.");
    expect((await repo.getTask(owner, id))!.projectId).toBe((await repo.findProjectByName(owner, "Task Hub"))!.id);
    expect(await call(client, "update_task", { taskId: id, project: null })).toBe("Zmieniono.");
    expect((await repo.getTask(owner, id))!.projectId).toBeNull();
    const nope = await call(client, "create_task", { title: "Nowy", project: "Nieznany" });
    expect(nope).toContain("Nie ma projektu „Nieznany”");
    expect((await repo.listTasks(owner)).some((t) => t.title === "Nowy")).toBe(false);
  });
});
