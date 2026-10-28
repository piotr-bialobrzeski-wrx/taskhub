// Paczka 27: każdy krok dostaje tylko swoje grafiki (przypisane przy rozpisaniu), a „Skąd” i galeria pokazują miniatury.
// Część z bazą pomijana bez TEST_DATABASE_URL.
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import sharp from "sharp";
import { stepAttachments, type Attachment } from "@/lib/repo";
import { thumbSrc } from "@/lib/safeurl";

const att = (id: string, stepId: string | null = null): Attachment => ({ id, stepId, kind: "image", name: id + ".jpg", url: `/api/files/${id}`, caption: null, analysis: null, keep: false, expiresAt: null, mime: "image/jpeg" });

describe("grafiki kroku: reguły", () => {
  const all = [att("a"), att("b"), att("p", "s1")];
  it("krok widzi przypisane i zapisane przy nim; nieprzypisany = null (wołający decyduje)", () => {
    expect(stepAttachments({ id: "s1", attachmentIds: ["b"] }, all)?.map((a) => a.id)).toEqual(["b", "p"]);
    expect(stepAttachments({ id: "s2", attachmentIds: [] }, all)).toEqual([]);
    expect(stepAttachments({ id: "s2", attachmentIds: null }, all)).toBeNull();
    expect(stepAttachments({ id: "s2" }, all)).toBeNull();
  });
  it("miniatura tylko dla pliku Task Hub", () => {
    const id = "0b7f9a52-4c1e-4f7e-9d38-2f3b9a1c5d10";
    expect(thumbSrc(`/api/files/${id}`)).toBe(`/api/files/${id}?w=s`);
    expect(thumbSrc(`https://taskhub-lac.vercel.app/api/files/${id}`)).toBe(`https://taskhub-lac.vercel.app/api/files/${id}?w=s`);
    expect(thumbSrc("https://example.com/a.png")).toBe("https://example.com/a.png");
    expect(thumbSrc(`/api/preview/${id}`)).toBe(`/api/preview/${id}`);
  });
});

vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));
vi.mock("@/lib/auth", async (orig) => ({ ...(await orig<typeof import("@/lib/auth")>()), isSignedIn: async () => true }));

describe.skipIf(!process.env.TEST_DATABASE_URL)("grafiki kroku: konektor, lista pracy i pliki", async () => {
  const repo = await import("@/lib/repo");
  const { sql } = await import("@/lib/db");
  const { workSummary } = await import("@/lib/agent/work");
  const run = await import("@/app/api/bridge/run/route");
  const work = await import("@/app/api/bridge/work/route");
  const mcp = await import("@/app/api/mcp/route");
  const files = await import("@/app/api/files/[id]/route");
  let owner = "", tok = "", runTok = "";
  const H = (t: string) => ({ Authorization: `Bearer ${t}` });
  const call = async (name: string, args: Record<string, unknown>) => {
    const r = await mcp.POST(new Request("http://x/api/mcp", { method: "POST", headers: { authorization: `Bearer ${runTok}`, "content-type": "application/json", accept: "application/json, text/event-stream" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }) }));
    const msgs = (await r.text()).split("\n").filter((l) => l.startsWith("data: ")).map((l) => JSON.parse(l.slice(6)));
    const m = msgs.find((x) => x.id === 1);
    return ((m?.result?.content ?? []) as { text?: string }[]).map((c) => c.text ?? "").join("\n") + (m?.error ? m.error.message : "");
  };
  const png = (w: number) => sharp({ create: { width: w, height: Math.round(w * 0.75), channels: 3, background: "#7a5cff" } }).png({ compressionLevel: 0 }).toBuffer();

  beforeAll(async () => {
    owner = (await repo.ensureOwner()).id;
    await sql()`delete from tasks where owner_id = ${owner}`;
    await sql()`delete from bridge_runs where owner_id = ${owner}`;
    await sql()`delete from api_tokens where owner_id = ${owner}`;
    tok = await repo.createApiToken(owner, "mini", "bridge");
    await work.GET(new Request("http://x/api/bridge/work?host=mini&runner=claude&state=idle&v=2", { headers: H(tok) }));
    runTok = (await (await run.POST(new Request("http://x/api/bridge/run", { method: "POST", headers: H(tok), body: JSON.stringify({ bridge: "mini", v: 2, kind: "work" }) }))).json()).token;
  });
  afterAll(async () => { await sql().end({ timeout: 2 }); });

  it("rozpisanie przypisuje grafiki krokom; agent dostaje tylko grafiki swojego kroku", async () => {
    const t = await repo.createTask(owner, { title: "Story zakładki Invited" });
    const [a1, a2] = await Promise.all([png(1600), png(1200)].map(async (p, i) => repo.addAttachment({ taskId: t.id }, { kind: "image", name: `ekran-${i}.png`, mime: "image/png", data: await p })));
    const bad = await call("add_steps", { taskId: t.id, steps: [{ title: "Przepisz story Review", tool: "clickup", attachments: ["00000000-0000-0000-0000-000000000000"] }] });
    expect(bad).toContain("Nie dodałem kroków");
    const r = await call("add_steps", { taskId: t.id, steps: [
      { title: "Przepisz story Review", tool: "clickup", attachments: [a1.id] },
      { title: "Przepisz story Remove", tool: "clickup", attachments: [] },
      { title: "Przepisz story kart", tool: "clickup" },
    ] });
    expect(r).toContain("nie mają attachments");
    expect(r).toContain("Przepisz story kart");
    const [s1, s2, s3] = (await repo.getTask(owner, t.id))!.steps;
    expect([s1.attachmentIds, s2.attachmentIds, s3.attachmentIds]).toEqual([[a1.id], [], null]);

    expect(await call("update_step", { stepId: s3.id, attachments: [a2.id, a2.id] })).toBe("Zmieniono.");
    expect((await repo.getTask(owner, t.id))!.steps[2].attachmentIds).toEqual([a2.id]);
    expect(await call("update_step", { stepId: s3.id, attachments: ["00000000-0000-0000-0000-000000000000"] })).toContain("Nic nie zmieniono");

    const g = await call("get_task", { taskId: t.id });
    expect(g).toMatch(new RegExp(`\\[${a1.id}\\][^\\n]*kroki: 01`));
    expect(g).toMatch(new RegExp(`\\[${a2.id}\\][^\\n]*kroki: 03`));

    const w = (await workSummary(owner, { peek: true, audience: "work" })).text;
    expect(w).toContain(`„Przepisz story Review” (clickup) w zadaniu [${t.id}] „Story zakładki Invited” | grafiki kroku: [${a1.id}]`);
    expect(w).toContain("„Przepisz story Remove” (clickup) w zadaniu");
    expect(w).toMatch(/Przepisz story Remove[^\n]*\| bez grafik/);
  });

  it("miniatura: mniejszy JPEG, zapisany raz; pełny plik pod zwykłym adresem; przeglądarka trzyma pliki długo", async () => {
    const t = await repo.createTask(owner, { title: "Miniatury" });
    const full = await png(2000);
    const a = await repo.addAttachment({ taskId: t.id }, { kind: "image", name: "duzy.png", mime: "image/png", data: full });
    const get = (q = "") => files.GET(new Request(`http://x/api/files/${a.id}${q}`), { params: Promise.resolve({ id: a.id }) });
    const r1 = await get("?w=s");
    expect(r1.headers.get("content-type")).toBe("image/jpeg");
    expect(r1.headers.get("cache-control")).toContain("immutable");
    const thumb = Buffer.from(await r1.arrayBuffer());
    expect(thumb.length).toBeLessThan(full.length / 10);
    expect((await sharp(thumb).metadata()).width).toBe(640);
    const [row] = await sql()`select octet_length(thumb) as n from attachments where id = ${a.id}`;
    expect(Number(row.n)).toBe(thumb.length);
    expect(Buffer.from(await (await get("?w=s")).arrayBuffer()).equals(thumb)).toBe(true);
    const r3 = await get();
    expect(r3.headers.get("content-type")).toBe("image/png");
    expect((await r3.arrayBuffer()).byteLength).toBe(full.length);
  });

  it("plik, który nie jest grafiką: ?w=s oddaje sam plik", async () => {
    const t = await repo.createTask(owner, { title: "Tekst" });
    const a = await repo.addAttachment({ taskId: t.id }, { kind: "file", name: "notatka.txt", mime: "text/plain", data: Buffer.from("treść") });
    const r = await files.GET(new Request(`http://x/api/files/${a.id}?w=s`), { params: Promise.resolve({ id: a.id }) });
    expect(await r.text()).toBe("treść");
  });
});
