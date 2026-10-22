// Paczka 11, punkt 3: szybki pasek na Macu wysyła tekst i pliki tą samą drogą co główne pole na kanwie (src/lib/intake.ts).
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));

describe.skipIf(!process.env.TEST_DATABASE_URL)("szybki pasek: /api/bridge/task", async () => {
  const repo = await import("@/lib/repo");
  const { sql } = await import("@/lib/db");
  const route = await import("@/app/api/bridge/task/route");
  let owner = "", tok = "";
  const post = (body: BodyInit, headers: Record<string, string> = {}) =>
    route.POST(new Request("http://x/api/bridge/task", { method: "POST", headers: { Authorization: `Bearer ${tok}`, ...headers }, body }));

  beforeAll(async () => {
    owner = (await repo.ensureOwner()).id;
    await sql()`delete from tasks where owner_id = ${owner}`;
    await sql()`delete from api_tokens where owner_id = ${owner}`;
    tok = await repo.createApiToken(owner, "mini", "bridge");
  });
  afterAll(async () => { await sql().end({ timeout: 2 }); });

  it("tekst z plikiem (multipart): zadanie jak z doku, plik w zadaniu, wpis w rozmowie, adres zadania w odpowiedzi", async () => {
    const fd = new FormData();
    fd.set("text", "Projekt: przygotuj ofertę dla klienta");
    fd.append("files", new File([new Uint8Array([137, 80, 78, 71])], "zrzut.png", { type: "image/png" }));
    const r = await post(fd);
    expect(r.status).toBe(200);
    const j = await r.json();
    expect(j.id).toBeTruthy();
    expect(j.url).toMatch(new RegExp(`/tasks/${j.id}$`));
    const t = await repo.getTask(owner, j.id);
    expect(t?.title).toBe("Projekt: przygotuj ofertę dla klienta");
    const att = await sql()`select name, kind from attachments where task_id = ${j.id}`;
    expect(att.map((a) => [a.name, a.kind])).toEqual([["zrzut.png", "image"]]);
    const chat = await repo.listChat(owner, null);
    expect(chat.some((m) => m.role === "user" && m.text.includes("(załączniki: zrzut.png)"))).toBe(true);
    expect(chat.at(-1)?.text).toBe(j.message);
  });

  it("sam plik bez tekstu: zadanie „Załącznik: …”; starszy JSON { text } dalej działa; pusta treść = 400", async () => {
    const fd = new FormData();
    fd.append("files", new File(["abc"], "notatka.txt", { type: "text/plain" }));
    const j = await (await post(fd)).json();
    expect((await repo.getTask(owner, j.id))?.title).toBe("Załącznik: notatka.txt");
    const k = await (await post(JSON.stringify({ text: "Stara wersja aplikacji" }), { "content-type": "application/json" })).json();
    expect((await repo.getTask(owner, k.id))?.title).toBe("Stara wersja aplikacji");
    expect((await post(JSON.stringify({ text: "  " }), { "content-type": "application/json" })).status).toBe(400);
  });

  it("bez tokenu mostka: 401", async () => {
    const r = await route.POST(new Request("http://x/api/bridge/task", { method: "POST", body: JSON.stringify({ text: "x" }) }));
    expect(r.status).toBe(401);
  });
});
