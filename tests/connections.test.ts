// Zgłoszenie mostka: stan z napisu `claude mcp list` i firma z nazwy konektora (bez bazy).
import { describe, it, expect } from "vitest";
import { bridgeServerOk, companyOfLabel } from "@/lib/repo";
import { appOfLabel } from "@/lib/schema";

describe("rejestr połączeń z mostka", () => {
  it("„✔ Connected” to działające połączenie, nawet gdy stara aplikacja na Macu przysłała ok: false", () => {
    expect(bridgeServerOk({ name: "slack-pirxey", ok: false, status: "✔ Connected" })).toBe(true);
    expect(bridgeServerOk({ name: "tapet", ok: false, status: "Connected" })).toBe(true);
    expect(bridgeServerOk({ name: "hubspot", ok: false, status: "! Needs authentication" })).toBe(false);
    expect(bridgeServerOk({ name: "x", ok: false, status: "✗ Failed to connect" })).toBe(false);
    expect(bridgeServerOk({ name: "x", ok: false, status: "Not connected" })).toBe(false);
    expect(bridgeServerOk({ name: "x", ok: true })).toBe(true);
  });
  it("firma z nazwy: słowo z nazwy firmy w nazwie konektora; zakończona współpraca się nie liczy", () => {
    const pw = { id: "1", name: "Pirxey & Widelab", sphere: "work" as const, note: null, endedAt: null };
    const old = { id: "2", name: "Veloza", sphere: "work" as const, note: null, endedAt: "2026-01-01T00:00:00Z" };
    expect(companyOfLabel("slack-pirxey", [pw])?.id).toBe("1");
    expect(companyOfLabel("google-widelab", [pw])?.id).toBe("1");
    expect(companyOfLabel("hubspot", [pw])).toBeNull();
    expect(companyOfLabel("google-veloza", [pw, old])).toBeNull();
  });
  it("aplikacja z nazwy: konto Google i konektory z Claude", () => {
    expect(appOfLabel("google-widelab")).toBe("google");
    expect(appOfLabel("Google Calendar")).toBe("calendar");
    expect(appOfLabel("Gmail")).toBe("gmail");
  });
});
