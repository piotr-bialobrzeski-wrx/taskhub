// Praca na żywo i automat: notatka biegu → zdanie po polsku i powiązanie z krokiem/zadaniem; klucz pulsu; najbliższy automat; kto rozpisze zadanie.
import { describe, it, expect } from "vitest";
import { activityText, liveActivity, liveKey, type LiveActivity } from "@/lib/live";
import { nextAutoAt } from "@/lib/clock";
import { allDoneWaitText, bridgeHold, busyWith, chatWho, msgCount, noStepsWho, newTaskText, queueWho, yourMsgsNom } from "@/lib/auto";
import { stepTile } from "@/lib/canvas/vm";
import { agentFeed } from "@/lib/feed";
import { task, step } from "./helpers";

const run = (note: string | null, extra: Partial<Parameters<typeof liveActivity>[0] & object> = {}) => ({ id: "r1", bridge: "Mac", startedAt: "2026-10-18T09:00:00Z", touchedAt: "2026-10-18T09:01:00Z", endedAt: null, outcome: null, note, taskId: null, stepId: null, ...extra });

describe("praca na żywo", () => {
  it("notatka „narzędzie: argument” staje się zdaniem po polsku; id zadań nie trafiają do szczegółu", () => {
    expect(activityText("get_task: 3b1d2c4e-1111-4222-8333-944455556666")).toEqual({ text: "czyta zadanie", detail: null });
    expect(activityText("Read: src/intake.js")).toEqual({ text: "czyta plik", detail: "src/intake.js" });
    expect(activityText("Bash: npm test")).toEqual({ text: "uruchamia polecenie", detail: "npm test" });
    expect(activityText("slack_search_messages: delivery date")?.text).toBe("używa: slack search messages");
    expect(activityText("start")).toEqual({ text: "zaczyna", detail: null });
    expect(activityText("")).toBeNull();
  });
  it("klucz pulsu zmienia się ze stemplem, notatką biegu, krokiem „teraz”, dotkniętymi krokami i życiem mostka; bieg zakończony nie liczy się", () => {
    const a = liveKey("s1", run("Read: a.ts"), true), b = liveKey("s1", run("Read: b.ts"), true);
    expect(a).not.toBe(b);
    expect(liveKey("s1", run("x"), true)).not.toBe(liveKey("s1", run("x"), false));
    expect(liveKey("s1", run("x"), true)).not.toBe(liveKey("s1", run("x", { stepId: "s1" }), true));
    const t1 = { first: "2026-10-18T09:00:30Z", at: "2026-10-18T09:00:30Z", what: "ułożył kartkę" };
    expect(liveKey("s1", run("x"), true)).not.toBe(liveKey("s1", run("x", { steps: { s1: t1 } }), true));
    expect(liveKey("s1", run("x", { steps: { s1: t1 } }), true)).not.toBe(liveKey("s1", run("x", { steps: { s1: { ...t1, at: "2026-10-18T09:02:00Z" } } }), true));
    expect(liveKey("s1", run("x", { endedAt: "2026-10-18T09:05:00Z" }), true)).toBe(liveKey("s1", null, true));
    expect(liveActivity(run("x", { endedAt: "2026-10-18T09:05:00Z" }))).toBeNull();
    expect(liveActivity(run(null))?.text).toBe("pracuje");
    expect(liveActivity(run("x", { steps: { s1: t1 }, stoppable: true }))).toMatchObject({ kind: "work", runId: "r1", steps: { s1: t1 }, stoppable: true });
  });
  it("kafelek kroku: światełko na kroku „teraz” (także w szkicu), stała obwódka z „Claude poprawił szkic · 19:43” na dotkniętym, kropka do pierwszego otwarcia", () => {
    const s1 = step({ id: "s1", title: "Napisz wiadomość", tool: "slack", status: "draft", blocks: [{ type: "draft", target: { app: "slack", action: "send", where: "#dev" }, body: "Hej", status: "proposed" }] });
    const s2 = step({ id: "s2", title: "Sprawdź logi", tool: "code", agentAt: "2026-10-18T17:40:00Z", openedAt: null });
    const s3 = step({ id: "s3", title: "Zadzwoń", tool: "manual", agentAt: "2026-10-18T17:40:00Z", openedAt: "2026-10-18T17:41:00Z" });
    const s4 = step({ id: "s4", title: "Zapisz fakty", tool: "code", agentAt: "2026-10-18T17:45:00Z", openedAt: "2026-10-18T17:41:00Z" });
    const t = task({ id: "t1", steps: [s1, s2, s3, s4] });
    const live: LiveActivity = { text: "poprawia szkic kroku", detail: null, since: "2026-10-18T17:30:00Z", stepId: "s1", taskId: "t1", bridge: "Mac", runId: "r1", kind: "work", steps: { s1: { first: "2026-10-18T17:35:00Z", at: "2026-10-18T17:43:00Z", what: "napisał szkic" }, s2: { first: "2026-10-18T17:40:00Z", at: "2026-10-18T17:43:00Z", what: "poprawił szkic" } } };
    const a = stepTile(t, s1, [t], live);
    expect(a).toMatchObject({ state: "draft", glow: "live", touched: null, fresh: false });
    expect(a.activity).toEqual({ text: "poprawia szkic", detail: null, since: "2026-10-18T17:30:00Z" });
    const b = stepTile(t, s2, [t], live);
    expect(b).toMatchObject({ glow: "touched", touched: "Claude poprawił szkic · 19:43", fresh: false, activity: null });   // obwódka zamiast kropki, póki bieg trwa
    expect(stepTile(t, s2, [t], null)).toMatchObject({ glow: null, touched: null, fresh: true });   // po biegu: kropka, bo Piotr nie otwierał
    expect(stepTile(t, s3, [t], null)).toMatchObject({ glow: null, fresh: false });   // otworzył po zmianie
    expect(stepTile(t, s4, [t], null)).toMatchObject({ fresh: true });   // zmieniony znów po otwarciu
    expect(stepTile(t, s2, [t], { ...live, taskId: "t2", stepId: "x", steps: {} })).toMatchObject({ glow: null, fresh: true });   // bieg nad innym zadaniem
  });
  it("dymek agenta: przyciski „Otwórz krok” do innych kroków dotkniętych w biegu (actions.steps)", () => {
    const m = (actions: unknown) => ({ id: "m1", role: "agent" as const, text: "Gotowe", actions, createdAt: new Date().toISOString(), seenAt: null, answeredAt: null });
    expect(agentFeed([m({ stepId: "s1", steps: ["s2", 3, "s4"] })])[0]).toMatchObject({ stepId: "s1", link: null, steps: ["s2", "s4"] });
    expect(agentFeed([m({ stepId: "s1" })])[0].steps).toEqual([]);
    expect(agentFeed([m(null)])[0]).toMatchObject({ stepId: null, steps: [] });
  });
});

describe("automat i komunikaty „kto pracuje”", () => {
  it("najbliższe uruchomienie: minuta 7, od 7:07 do 22:07, potem jutro", () => {
    const at = (iso: string) => nextAutoAt(new Date(iso));
    expect(at("2026-10-18T09:33:00Z")).toMatchObject({ time: "12:07", tomorrow: false, text: "o 12:07" });   // 11:33 w Warszawie
    expect(at("2026-10-18T09:03:00Z").time).toBe("11:07");
    expect(at("2026-10-18T20:30:00Z")).toMatchObject({ time: "07:07", tomorrow: true, text: "jutro o 07:07" });   // 22:30
    expect(at("2026-10-18T03:00:00Z")).toMatchObject({ time: "07:07", tomorrow: false });
  });
  it("zadanie bez kroków: mostek rozpisuje / kończy inną pracę / weźmie za chwilę / automat o pełnej godzinie", () => {
    const t = task({ id: "t1", steps: [step({ id: "s1", title: "Zmień etykietę daty" })] });
    const live = { text: "zmienia plik", detail: "intake.js", since: "2026-10-18T09:00:00Z", stepId: "s1", taskId: "t1", bridge: "Mac" };
    expect(noStepsWho({ alive: true, name: "Mac", run: live }, "t1").kind).toBe("decomposing");
    const busy = noStepsWho({ alive: true, name: "Mac", run: live }, "t2", busyWith(live, [t]));
    expect(busy.kind).toBe("busy"); expect(busy.text).toContain("Zmień etykietę daty");
    expect(noStepsWho({ alive: true, name: null, run: null }, "t2").text).toContain("w ciągu minuty");
    const auto = noStepsWho({ alive: false, name: null, run: null }, "t2", null, new Date("2026-10-18T09:33:00Z"));
    expect(auto.kind).toBe("auto"); expect(auto.text).toContain("o 12:07");
    expect(newTaskText("Bardzo długi tytuł zadania, które wpadło z maila od klienta i ma wiele słów", auto)).toMatch(/^Dodałem zadanie „Bardzo długi tytuł zadania, które wpadło z maila od klienta…”\. Nikt teraz nie pracuje/);
    expect(chatWho({ alive: false, name: null, run: null }, "t1", null, new Date("2026-10-18T09:33:00Z"))).toContain("o 12:07");
    expect(chatWho({ alive: true, name: null, run: null }, "t1")).not.toContain("wezm");
  });
});

describe("kolejka wiadomości Piotra w zadaniu", () => {
  const live = { text: "układa kartkę kroku", detail: null, since: "2026-10-18T09:00:00Z", stepId: null, taskId: "t1", bridge: "Mac" };
  it("mostek pracuje nad tym zadaniem: linia z czynnością; nad innym: kończy, potem przeczyta; żywy bez biegu: w ciągu minuty; martwy: automat o pełnej godzinie", () => {
    const working = queueWho({ alive: true, name: "Mac", run: live }, "t1", 2);
    expect(working).toMatchObject({ kind: "working", text: "Mostek (Mac) pracuje nad Twoimi 2 wiadomościami", short: "Mostek pracuje nad tym" });
    expect(working.activity).toBe(live);
    expect(queueWho({ alive: true, name: "Mac", run: live }, "t1", 1).text).toBe("Mostek (Mac) pracuje nad Twoją wiadomością");
    const busy = queueWho({ alive: true, name: "Mac", run: live }, "t2", 3, "Zmień etykietę daty");
    expect(busy.kind).toBe("busy"); expect(busy.text).toBe("Mostek (Mac) kończy: Zmień etykietę daty, potem przeczyta Twoje 3 wiadomości"); expect(busy.activity).toBeNull();
    expect(queueWho({ alive: true, name: null, run: null }, "t1", 2)).toMatchObject({ kind: "soon", text: "2 wiadomości czekają na mostek · weźmie je w ciągu minuty" });
    expect(queueWho({ alive: true, name: null, run: null }, "t1", 1).text).toBe("1 wiadomość czeka na mostek · weźmie ją w ciągu minuty");
    const auto = queueWho({ alive: false, name: null, run: null }, "t1", 5, null, new Date("2026-10-18T09:33:00Z"));
    expect(auto.kind).toBe("auto"); expect(auto.text).toBe("5 wiadomości czekają na Claude · zajrzy o 12:07 (automat co godzinę)"); expect(auto.short).toBe("Czeka na Claude o 12:07");
  });
  it("mostek żywy, ale wstrzymany (limit, wylogowanie, błąd): mówi dlaczego stoi zamiast „w ciągu minuty”", () => {
    const limit = bridgeHold({ state: "limit", until: "2026-10-18T23:00:00Z" });
    expect(limit).toEqual({ kind: "limit", until: "2026-10-18T23:00:00Z" });
    const q = queueWho({ alive: true, name: "Mac", run: null, hold: limit }, "t1", 1);
    expect(q).toMatchObject({ kind: "held", text: "1 wiadomość czeka · mostek stoi: limit Claude do 01:00", short: "Czeka: limit Claude do 01:00" });
    expect(allDoneWaitText(q)).toContain("czeka na mostek");
    expect(queueWho({ alive: true, name: null, run: null, hold: bridgeHold({ state: "auth" }) }, "t1", 2).text).toContain("Claude Code wylogowany");
    expect(noStepsWho({ alive: true, name: null, run: null, hold: limit }, "t1").kind).toBe("held");
    expect(chatWho({ alive: true, name: null, run: null, hold: limit }, "t1")).toContain("stoi: limit Claude do 01:00");
    // bieg trwa: liczy się bieg, nie stary stan; idle, check i pusty termin to brak wstrzymania
    expect(queueWho({ alive: true, name: "Mac", run: live, hold: limit }, "t1", 1).kind).toBe("working");
    expect([bridgeHold({ state: "idle", until: "2026-10-18T23:00:00Z" }), bridgeHold({ state: "check" }), bridgeHold(null)]).toEqual([null, null, null]);
    expect(bridgeHold({ state: "error", until: "" })).toEqual({ kind: "error", until: null });
    // Piotr zatrzymał bieg na Macu (aplikacja 0.1.7): przerwa do podanej godziny
    const stopped = bridgeHold({ state: "stopped", until: "2026-10-18T09:10:00Z" });
    expect(stopped).toEqual({ kind: "stopped", until: "2026-10-18T09:10:00Z" });
    expect(chatWho({ alive: true, name: null, run: null, hold: stopped }, "t1")).toContain("stoi: zatrzymany przez Ciebie, wraca o 11:10");
  });
  it("pasek po ostatnim kroku i odmiana liczebników", () => {
    expect(allDoneWaitText(queueWho({ alive: true, name: "Mac", run: null }, "t1", 2))).toBe("Kroki zrobione · 2 Twoje wiadomości czekają na mostek");
    expect(allDoneWaitText(queueWho({ alive: false, name: null, run: null }, "t1", 1))).toBe("Kroki zrobione · Twoja wiadomość czeka na Claude");
    expect([1, 2, 5, 22].map(msgCount)).toEqual(["1 wiadomość", "2 wiadomości", "5 wiadomości", "22 wiadomości"]);
    expect([1, 2].map(yourMsgsNom)).toEqual(["Twoja wiadomość", "2 Twoje wiadomości"]);
  });
});
