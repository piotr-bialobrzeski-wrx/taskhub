import { describe, expect, it } from "vitest";
import { CHAT_W_DEFAULT, clampChatW, readChatSide, writeChatSide } from "../src/lib/chat-side";

const mem = () => { const m = new Map<string, string>(); return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) }; };

describe("paczka 52: panel czatu po lewej w widoku kroku", () => {
  it("szerokość w granicach 300-720 px i najwyżej połowa okna", () => {
    expect(clampChatW(380, 1440)).toBe(380);
    expect(clampChatW(100, 1440)).toBe(300);
    expect(clampChatW(2000, 1920)).toBe(720);
    expect(clampChatW(700, 1000)).toBe(500);
    expect(clampChatW(NaN, 1440)).toBe(CHAT_W_DEFAULT);
  });
  it("domyślnie 380 px i historia pokazana", () => {
    expect(readChatSide(mem())).toEqual({ w: 380, open: true });
    expect(readChatSide(null)).toEqual({ w: 380, open: true });
  });
  it("zapamiętuje szerokość i schowaną historię", () => {
    const s = mem();
    writeChatSide({ w: 452.4 }, s); writeChatSide({ open: false }, s);
    expect(readChatSide(s)).toEqual({ w: 452, open: false });
    writeChatSide({ open: true }, s);
    expect(readChatSide(s).open).toBe(true);
  });
  it("zablokowane dane w przeglądarce nie psują panelu", () => {
    const bad = { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("blocked"); } };
    expect(readChatSide(bad)).toEqual({ w: 380, open: true });
    expect(() => writeChatSide({ w: 400, open: false }, bad)).not.toThrow();
  });
});
