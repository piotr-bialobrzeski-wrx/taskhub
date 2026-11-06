// Paczka 51: prośba Piotra w czacie kroku zmienia kartkę od razu (czeka na Claude'a → Claude wprowadza zmiany), szkic sprzed prośby jest nieaktualny
import { describe, expect, it } from "vitest";
import { redoOf } from "@/lib/stepcard";

const T = "task-1", S = "step-5";
const msg = (text: string, at: string, extra: { stepId?: string; seenAt?: string | null } = {}) => ({ text, actions: { stepId: extra.stepId ?? S }, createdAt: at, seenAt: extra.seenAt ?? null });
const live = (stepId: string | null, taskId = T) => ({ text: "zmienia plik", detail: "Table.tsx", since: "2026-11-06T10:25:00Z", taskId, stepId });

describe("redoOf: stan prośby z czatu kroku", () => {
  it("bez wiadomości przy kroku nic się nie zmienia", () => {
    expect(redoOf([], T, S, null)).toBeNull();
    expect(redoOf([msg("inny krok", "2026-11-06T10:00:00Z", { stepId: "step-2" })], T, S, null)).toBeNull();
  });
  it("wiadomość niewzięta i brak biegu: prośba czeka na Claude'a", () => {
    const r = redoOf([msg("Dodaj kolumnę Status", "2026-11-06T10:23:00Z")], T, S, null)!;
    expect(r.state).toBe("waiting");
    expect(r.text).toBe("Dodaj kolumnę Status");
    expect(r.activity).toBeNull();
  });
  it("agent wziął wiadomość albo bieg pracuje nad krokiem: Claude wprowadza zmiany, z bieżącą czynnością tylko z biegu", () => {
    expect(redoOf([msg("a", "2026-11-06T10:23:00Z", { seenAt: "2026-11-06T10:24:00Z" })], T, S, null)).toMatchObject({ state: "working", activity: null });
    expect(redoOf([msg("a", "2026-11-06T10:23:00Z")], T, S, live(S))).toMatchObject({ state: "working", activity: { text: "zmienia plik", detail: "Table.tsx" } });
    expect(redoOf([msg("a", "2026-11-06T10:23:00Z")], T, S, live(null))?.state).toBe("working");
  });
  it("bieg nad innym krokiem albo innym zadaniem nie udaje pracy nad prośbą", () => {
    expect(redoOf([msg("a", "2026-11-06T10:23:00Z")], T, S, live("step-2"))).toMatchObject({ state: "waiting", activity: null });
    expect(redoOf([msg("a", "2026-11-06T10:23:00Z")], T, S, live(S, "task-2"))).toMatchObject({ state: "waiting", activity: null });
  });
  it("kilka próśb: najnowsza w treści, czas od najstarszej, długa skrócona", () => {
    const r = redoOf([msg("druga " + "x".repeat(300), "2026-11-06T10:30:00Z"), msg("pierwsza", "2026-11-06T10:20:00Z")], T, S, null)!;
    expect(r.count).toBe(2);
    expect(r.at).toBe("2026-11-06T10:20:00Z");
    expect(r.text.startsWith("druga")).toBe(true);
    expect(r.text.length).toBeLessThanOrEqual(160);
  });
});
