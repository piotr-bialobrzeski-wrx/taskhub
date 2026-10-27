// Paczka 22: agent w tle jak Claude Code Piotra. Krok oddany z braku dostępu nie wraca co kilka minut, tylko po czymś nowym
// (wiadomość, odpowiedź, zmiana folderów w aplikacji na Macu); brakujący folder daje na karcie „Dodaj folder”; prototyp HTML
// dostaje adres w Task Hub (add_preview) zamiast artefaktu. Część z bazą pomijana bez TEST_DATABASE_URL.
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { bridgeAccessAt, retryAfterLeft } from "@/lib/agent/work";
import { folderLink } from "@/lib/stepcard";
import { safeHref } from "@/lib/safeurl";

describe("dostęp: reguły", () => {
  it("krok wraca po sygnale albo zmianie folderów, nie wcześniej", () => {
    expect(retryAfterLeft("2026-10-27T09:00:00Z", null, null)).toBe(false);
    expect(retryAfterLeft("2026-10-27T09:00:00Z", "2026-10-27T08:59:00Z", "2026-10-27T08:00:00Z")).toBe(false);
    expect(retryAfterLeft("2026-10-27T09:00:00Z", "2026-10-27T09:01:00Z", null)).toBe(true);
    expect(retryAfterLeft("2026-10-27T09:00:00.000Z", null, "2026-10-27T09:00:01.000Z")).toBe(true);
  });
  it("zmiana folderów: najnowsza z komputerów", () => {
    expect(bridgeAccessAt({})).toBeNull();
    expect(bridgeAccessAt({ bridgeAccess: { dom: { key: "a", at: "2026-10-27T08:00:00.000Z" }, praca: { key: "b", at: "2026-10-27T09:00:00.000Z" } } })).toBe("2026-10-27T09:00:00.000Z");
    expect(bridgeAccessAt({ bridgeAccess: "zły" })).toBeNull();
  });
  it("„Dodaj folder”: tylko oddany krok z brakującym folderem; ścieżka ze spacją jako %20", () => {
    const need = { kind: "folder" as const, folder: "code" as const, path: "~/kontekst-projektow/praca__pirxey-os" };
    expect(folderLink({ leftAt: "2026-10-27T09:00:00Z", need, status: "todo" })).toEqual({
      href: "taskhub://add-folder?kind=code&path=~%2Fkontekst-projektow%2Fpraca__pirxey-os", path: need.path, section: "Foldery z kodem" });
    expect(folderLink({ leftAt: null, need, status: "todo" })).toBeNull();
    expect(folderLink({ leftAt: "2026-10-27T09:00:00Z", need: { kind: "piotr" }, status: "todo" })).toBeNull();
    expect(folderLink({ leftAt: "2026-10-27T09:00:00Z", need: { ...need, folder: "files", path: "/Users/a/Moje pliki" }, status: "todo" })?.href).toBe("taskhub://add-folder?kind=files&path=%2FUsers%2Fa%2FMoje%20pliki");
  });
  it("podgląd prototypu jest bezpiecznym adresem w Task Hub", () => {
    expect(safeHref("/api/preview/0b7f9a52-4c1e-4f7e-9d38-2f3b9a1c5d10")).toBe("/api/preview/0b7f9a52-4c1e-4f7e-9d38-2f3b9a1c5d10");
    expect(safeHref("/api/preview/../files")).toBeUndefined();
  });
});

vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));
vi.mock("@/lib/auth", async (orig) => ({ ...(await orig<typeof import("@/lib/auth")>()), isSignedIn: async () => true }));

describe.skipIf(!process.env.TEST_DATABASE_URL)("dostęp: mostek i konektor", async () => {
  const repo = await import("@/lib/repo");
  const { sql } = await import("@/lib/db");
  const { workSummary } = await import("@/lib/agent/work");
  const run = await import("@/app/api/bridge/run/route");
  const work = await import("@/app/api/bridge/work/route");
  const mcp = await import("@/app/api/mcp/route");
  const preview = await import("@/app/api/preview/[id]/route");
  let owner = "", tok = "";
  const H = (t: string) => ({ Authorization: `Bearer ${t}` });
  const call = async (t: string, name: string, args: Record<string, unknown>) => {
    const r = await mcp.POST(new Request("http://x/api/mcp", { method: "POST", headers: { authorization: `Bearer ${t}`, "content-type": "application/json", accept: "application/json, text/event-stream" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }) }));
    const msgs = (await r.text()).split("\n").filter((l) => l.startsWith("data: ")).map((l) => JSON.parse(l.slice(6)));
    const m = msgs.find((x) => x.id === 1);
    return ((m?.result?.content ?? []) as { text?: string }[]).map((c) => c.text ?? "").join("\n") + (m?.error ? m.error.message : "");
  };
  const postRun = async () => (await run.POST(new Request("http://x/api/bridge/run", { method: "POST", headers: H(tok), body: JSON.stringify({ bridge: "mini", v: 2, kind: "work" }) }))).json();
  const closeOpen = async () => { const open = (await repo.bridgeStatus(owner, 0)).run; if (open) await repo.endBridgeRun(owner, open.id, "done"); };
  const poll = async (access: string) => work.GET(new Request(`http://x/api/bridge/work?host=mini&runner=claude&state=idle&v=2&access=${access}`, { headers: H(tok) }));
  const listed = async (id: string) => (await workSummary(owner, { peek: true, audience: "work" })).text.includes(id);
  const stepOf = async (taskId: string, id: string) => (await repo.getTask(owner, taskId))!.steps.find((s) => s.id === id)!;

  beforeAll(async () => {
    owner = (await repo.ensureOwner()).id;
    await sql()`delete from tasks where owner_id = ${owner}`;
    await sql()`delete from bridge_runs where owner_id = ${owner}`;
    await sql()`delete from api_tokens where owner_id = ${owner}`;
    await sql()`delete from chat_messages where owner_id = ${owner}`;
    await repo.setUserSettings(owner, { models: null, bridgeAccess: {} });
    tok = await repo.createApiToken(owner, "mini", "bridge");
  });
  afterAll(async () => { await sql().end({ timeout: 2 }); });

  it("brak folderu: krok czeka na Piotra, karta ma folder, zmiana folderów na Macu oddaje go do pracy", async () => {
    const t = await repo.createTask(owner, { title: "Prototyp sekcji zdjęć", steps: [{ title: "Przygotuj prototyp HTML", tool: "code" }] });
    const id = t.steps[0].id;
    await poll("aaa1");
    const b = await postRun();
    expect(await call(b.token, "start_step", { stepId: id })).toBe("Krok w toku.");
    expect(await call(b.token, "leave_step", { stepId: id, reason: "Nie widzę kodu Pirxey Time.", needFolder: { kind: "code", path: "~/kontekst-projektow/praca__pirxey-os" } })).toBe("Krok oddany.");
    await closeOpen();
    const s = await stepOf(t.id, id);
    expect(s.need).toEqual({ kind: "folder", folder: "code", path: "~/kontekst-projektow/praca__pirxey-os" });
    expect(s.leftAt).toBeTruthy();
    expect(s.escalation).toBe(0);   // mocniejszy model nie doda folderu
    expect(await listed(id)).toBe(false);
    // ten sam odcisk folderów: nic nowego
    await poll("aaa1");
    expect(await listed(id)).toBe(false);
    // Piotr dodał folder w aplikacji: krok wraca
    await new Promise((r) => setTimeout(r, 5));
    await poll("bbb2");
    expect(await listed(id)).toBe(true);
    await sql()`delete from tasks where id = ${t.id}`;
  });

  it("blokada bez folderu czeka na wiadomość Piotra; zwykłe oddanie idzie od razu poziom wyżej", async () => {
    const t = await repo.createTask(owner, { title: "Raport", steps: [{ title: "Zbierz dane", tool: "code" }, { title: "Popraw opis", tool: "code" }] });
    const [a, c] = t.steps.map((s) => s.id);
    let b = await postRun();
    await call(b.token, "leave_step", { stepId: a, reason: "Brak dostępu do arkusza.", blocked: true });
    await call(b.token, "leave_step", { stepId: c, reason: "Nie rozumiem opisu." });
    await closeOpen();
    expect((await stepOf(t.id, a)).need).toEqual({ kind: "piotr" });
    expect((await stepOf(t.id, c)).escalation).toBe(1);
    expect(await listed(a)).toBe(false);
    expect(await listed(c)).toBe(true);
    await new Promise((r) => setTimeout(r, 5));
    await repo.addChat(owner, t.id, "user", "Dałem dostęp do arkusza.");
    expect(await listed(a)).toBe(true);
    // na najwyższym poziomie oddanie też czeka na Piotra (bez kolejnych prób co kilka minut)
    await sql()`update steps set escalation = 2 where id = ${c}`;
    b = await postRun();
    await call(b.token, "leave_step", { stepId: c, reason: "Nadal nie rozumiem." });
    await closeOpen();
    expect((await stepOf(t.id, c)).need).toEqual({ kind: "piotr" });
    expect(await listed(c)).toBe(false);
    await sql()`delete from tasks where id = ${t.id}`;
  });

  it("add_preview: adres w Task Hub, link kroku, strona w piaskownicy tylko dla text/html", async () => {
    const t = await repo.createTask(owner, { title: "Prototyp", steps: [{ title: "Przygotuj prototyp HTML", tool: "code" }, { title: "Zatwierdź prototyp", tool: "manual" }] });
    const id = t.steps[0].id;
    const b = await postRun();
    expect(await call(b.token, "add_preview", { stepId: id, title: "Sekcja zdjęć", html: "bez znaczników, sam tekst prototypu" })).toContain("nie wygląda na stronę HTML");
    const out = await call(b.token, "add_preview", { stepId: id, title: "Sekcja zdjęć", html: "<!doctype html><html><body><h1>Zdjęcia</h1><script>1</script></body></html>" });
    await closeOpen();
    const url = out.match(/https?:\/\/\S+\/api\/preview\/([0-9a-f-]{36})/);
    expect(url).toBeTruthy();
    expect((await stepOf(t.id, id)).link).toBe(url![0]);
    const att = (await repo.listAttachments({ taskId: t.id }))[0];
    expect(att.url).toBe(`/api/preview/${url![1]}`);
    const r = await preview.GET(new Request("http://x"), { params: Promise.resolve({ id: url![1] }) });
    expect(r.status).toBe(200);
    expect(r.headers.get("content-type")).toContain("text/html");
    expect(r.headers.get("content-security-policy")).toMatch(/^sandbox allow-scripts/);
    expect(r.headers.get("content-security-policy")).not.toContain("allow-same-origin");
    expect(r.headers.get("content-security-policy")).toContain("connect-src 'none'");
    expect(await r.text()).toContain("<h1>Zdjęcia</h1>");
    // zwykły załącznik (np. obrazek) nie otwiera się jako podgląd
    const img = await repo.addAttachment({ taskId: t.id }, { kind: "image", name: "a.png", mime: "image/png", data: Buffer.from([1, 2, 3]) });
    expect((await preview.GET(new Request("http://x"), { params: Promise.resolve({ id: img.id }) })).status).toBe(404);
    await sql()`delete from tasks where id = ${t.id}`;
  });
});
