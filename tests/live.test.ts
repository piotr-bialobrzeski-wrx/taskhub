// Praca na żywo i automat: notatka biegu → zdanie po polsku i powiązanie z krokiem/zadaniem; klucz pulsu; najbliższy automat; kto rozpisze zadanie.
import { describe, it, expect } from "vitest";
import { activityText, linkOfNote, liveActivity, liveKey } from "@/lib/live";
import { nextAutoAt } from "@/lib/clock";
import { allDoneWaitText, busyWith, chatWho, msgCount, noStepsWho, newTaskText, queueWho, yourMsgsNom } from "@/lib/auto";
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
  it("bieg wiąże się z krokiem (start_step, set_blocks, complete_step) albo zadaniem (get_task, add_steps, reply_chat)", () => {
    const id = "3b1d2c4e-1111-4222-8333-944455556666";
    expect(linkOfNote(`start_step: ${id}`)).toEqual({ stepId: id });
    expect(linkOfNote(`complete_step: ${id}`)).toEqual({ stepId: id });
    expect(linkOfNote(`get_task: ${id}`)).toEqual({ taskId: id });
    expect(linkOfNote(`reply_chat: ${id}`)).toEqual({ taskId: id });
    expect(linkOfNote("Read: plik.ts")).toBeNull();
    expect(linkOfNote("list_work")).toBeNull();
  });
  it("klucz pulsu zmienia się ze stemplem, notatką biegu i życiem mostka; bieg zakończony nie liczy się", () => {
    const a = liveKey("s1", run("Read: a.ts"), true), b = liveKey("s1", run("Read: b.ts"), true);
    expect(a).not.toBe(b);
    expect(liveKey("s1", run("x"), true)).not.toBe(liveKey("s1", run("x"), false));
    expect(liveKey("s1", run("x", { endedAt: "2026-10-18T09:05:00Z" }), true)).toBe(liveKey("s1", null, true));
    expect(liveActivity(run("x", { endedAt: "2026-10-18T09:05:00Z" }))).toBeNull();
    expect(liveActivity(run(null))?.text).toBe("pracuje");
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
  it("pasek po ostatnim kroku i odmiana liczebników", () => {
    expect(allDoneWaitText(queueWho({ alive: true, name: "Mac", run: null }, "t1", 2))).toBe("Wszystkie kroki gotowe; czekam, aż mostek odpowie na Twoje 2 wiadomości.");
    expect(allDoneWaitText(queueWho({ alive: false, name: null, run: null }, "t1", 1))).toBe("Wszystkie kroki gotowe; czekam, aż Claude odpowie na Twoją wiadomość.");
    expect([1, 2, 5, 22].map(msgCount)).toEqual(["1 wiadomość", "2 wiadomości", "5 wiadomości", "22 wiadomości"]);
    expect([1, 2].map(yourMsgsNom)).toEqual(["Twoja wiadomość", "2 Twoje wiadomości"]);
  });
});
