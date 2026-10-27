// Paczka 22: szkic pola czatu trzymamy tylko do wysłania; po wysłaniu znika (także gdy wysłanie przenosi do innego zadania), przy błędzie wraca.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { draftKeyOf, readDraft, sendKeepingDraft, writeDraft, type DraftStore } from "@/lib/chat-draft";

const store = (): DraftStore & { m: Map<string, string> } => {
  const m = new Map<string, string>();
  return { m, getItem: (k) => m.get(k) ?? null, setItem: (k, v) => void m.set(k, v), removeItem: (k) => void m.delete(k) };
};
const form = (text: string) => { const fd = new FormData(); fd.set("text", text); return fd; };

describe("szkic pola czatu", () => {
  it("każde miejsce czatu ma własny szkic, który przetrwa przejście gdzie indziej", () => {
    const s = store();
    writeDraft(draftKeyOf("t1", null), "w zadaniu", s);
    writeDraft(draftKeyOf(null, null), "na kanwie", s);
    expect(readDraft(draftKeyOf("t1", null), s)).toBe("w zadaniu");
    expect(readDraft(draftKeyOf("t1", "k1"), s)).toBe("");
    expect(readDraft(draftKeyOf(null, null), s)).toBe("na kanwie");
  });
  it("szkic znika już w chwili wysłania, zanim przyjdzie odpowiedź", async () => {
    const s = store(); const key = draftKeyOf(null, null);
    writeDraft(key, "Wyślij wiadomość do Kingi", s);
    let during = "?";
    const r = await sendKeepingDraft(async () => { during = readDraft(key, s); }, form("Wyślij wiadomość do Kingi"), key, s);
    expect(during).toBe("");
    expect(r.failed).toBe(false);
    expect(readDraft(key, s)).toBe("");
  });
  it("wysłanie, które przenosi do innego zadania, też czyści szkic", async () => {
    const s = store(); const key = draftKeyOf(null, null);
    writeDraft(key, "nowe zadanie", s);
    const redirect = Object.assign(new Error("NEXT_REDIRECT"), { digest: "NEXT_REDIRECT;push;/tasks/x;307;" });
    await expect(sendKeepingDraft(async () => { throw redirect; }, form("nowe zadanie"), key, s)).rejects.toBe(redirect);
    expect(readDraft(key, s)).toBe("");
  });
  it("gdy wysłanie się nie uda, tekst wraca do szkicu", async () => {
    const s = store(); const key = draftKeyOf("t1", "k1");
    writeDraft(key, "ważny tekst", s);
    const r = await sendKeepingDraft(async () => { throw new Error("sieć"); }, form("ważny tekst"), key, s);
    expect(r).toEqual({ key, text: "ważny tekst", failed: true });
    expect(readDraft(key, s)).toBe("ważny tekst");
  });
  it("pole czatu wysyła przez sendKeepingDraft i po błędzie oddaje tekst do pola", () => {
    const w = readFileSync("src/components/canvas/widgets.tsx", "utf8");
    expect(w).toContain("action={send}");
    expect(w).toContain("sendKeepingDraft(action, fd, draftKeyOf(taskId, stepId))");
    expect(w).toMatch(/s\?\.failed\) \{ if \(el\) \{ el\.value = s\.text/);
  });
});
