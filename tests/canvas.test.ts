// Układ kanwy i modele kafelków: czysta logika, bez bazy.
import { describe, it, expect } from "vitest";
import { computePositions, gridFor, membership, OX, OY, STEP_SIZE, TASK_SIZE, GX, GY } from "@/lib/canvas/layout";
import { stepStateOf, taskStateOf, dueOf, stepTile } from "@/lib/canvas/vm";
import { externalLink } from "@/lib/links";
import { step, task } from "./helpers";

const it3 = [
  { id: "a", dependsOn: [], pos: null },
  { id: "b", dependsOn: ["a"], pos: null },
  { id: "c", dependsOn: ["a"], pos: null },
  { id: "d", dependsOn: ["b", "c"], pos: null },
];

describe("układ kanwy", () => {
  it("elementy bez zależności w kolumnie 0, zależne w kolejnych; równoległe jeden pod drugim", () => {
    const { grid, depth } = gridFor(it3, 0);
    expect(depth).toEqual({ a: 0, b: 1, c: 1, d: 2 });
    expect(grid.a).toEqual({ c: 0, r: 0 });
    expect(grid.b).toEqual({ c: 1, r: 0 });
    expect(grid.c).toEqual({ c: 1, r: 1 });
    expect(grid.d).toEqual({ c: 2, r: 0 });
  });
  it("na kanwie kroków kolumnę 0 zajmuje kafelek zadania, kroki zaczynają się obok", () => {
    const L = computePositions(it3, [], STEP_SIZE, true);
    expect(L.origin).toEqual({ x: OX, y: OY });
    expect(L.P.a).toEqual({ x: OX + STEP_SIZE.w + GX, y: OY });
    expect(L.P.c.y).toBe(OY + STEP_SIZE.h + GY);
  });
  it("zapisane położenie zostaje, nowy kafelek omija zajęte miejsce", () => {
    const list = [{ id: "x", dependsOn: [], pos: { x: OX, y: OY } }, { id: "y", dependsOn: [], pos: null }];
    const L = computePositions(list, [], TASK_SIZE, false);
    expect(L.P.x).toEqual({ x: OX, y: OY });
    expect(L.P.y.y).toBeGreaterThanOrEqual(OY + TASK_SIZE.h);
  });
  it("grupa automatyczna obejmuje swoje kafelki, a przynależność liczy się po środku kafelka", () => {
    const g = { id: "g", x: 0, y: 0, w: 0, h: 0, members: ["b", "c"], auto: true };
    const L = computePositions(it3, [g], STEP_SIZE, true);
    const G = L.groups[0];
    expect(G.members).toEqual(["b", "c"]);
    expect(L.P.b.x).toBeGreaterThanOrEqual(G.x);
    expect(L.P.c.y + STEP_SIZE.h).toBeLessThanOrEqual(G.y + G.h);
    const m = membership([G], L.P, STEP_SIZE);
    expect(m.g.sort()).toEqual(["b", "c"]);
  });
  it("cykl zależności nie zawiesza układu", () => {
    const { depth } = gridFor([{ id: "a", dependsOn: ["b"], pos: null }, { id: "b", dependsOn: ["a"], pos: null }], 0);
    expect(Object.keys(depth).sort()).toEqual(["a", "b"]);
  });
});

describe("stany kafelków", () => {
  it("zadanie: nowe → w toku → do zatwierdzenia → ukończone; czeka, gdy zależy od nieukończonego", () => {
    const s1 = step({ status: "todo" }), s2 = step({ status: "todo" });
    const t = task({ steps: [s1, s2] });
    expect(taskStateOf(t, [t])).toBe("new");
    expect(taskStateOf({ ...t, steps: [{ ...s1, status: "done" }, s2] }, [t])).toBe("active");
    expect(taskStateOf({ ...t, steps: [s1, { ...s2, status: "draft" }] }, [t])).toBe("draft");
    expect(taskStateOf({ ...t, steps: [{ ...s1, status: "done" }, { ...s2, status: "done" }] }, [t])).toBe("done");
    const other = task({ steps: [step()] });
    expect(taskStateOf({ ...t, dependsOn: [other.id] }, [t, other])).toBe("blocked");
  });
  it("krok: gotowy, gdy poprzednie zrobione; czeka, gdy nie", () => {
    const a = step({ status: "todo" }), b = step({ status: "todo", dependsOn: [a.id] });
    const t = task({ steps: [a, b] });
    expect(stepStateOf(t, a, [t])).toBe("ready");
    expect(stepStateOf(t, b, [t])).toBe("blocked");
    const t2 = { ...t, steps: [{ ...a, status: "done" as const }, b] };
    expect(stepStateOf(t2, b, [t2])).toBe("ready");
    expect(stepStateOf(t, { ...a, status: "handoff" }, [t])).toBe("handoff");
  });
  it("termin: po terminie, wkrótce, zwykły", () => {
    const now = new Date("2026-10-15T10:00:00").getTime();
    expect(dueOf("2026-10-14", now)?.cls).toBe("late");
    expect(dueOf("2026-10-14", now)?.text).toBe("po terminie");
    expect(dueOf("2026-10-16", now)?.cls).toBe("soon");
    expect(dueOf("2026-10-30", now)?.cls).toBe("");
    expect(dueOf(null, now)).toBeNull();
  });
});

describe("linki kroków", () => {
  const app = "https://taskhub-lac.vercel.app";
  it("odrzuca adres samej aplikacji i nie-http, przyjmuje zewnętrzne", () => {
    expect(externalLink("https://taskhub-lac.vercel.app/tasks/1", app)).toBeUndefined();
    expect(externalLink("mailto:a@b.pl", app)).toBeUndefined();
    expect(externalLink("nie-url", app)).toBeUndefined();
    expect(externalLink("https://mail.google.com/mail/u/0/#inbox/abc", app)).toBe("https://mail.google.com/mail/u/0/#inbox/abc");
    expect(externalLink(null, app)).toBeUndefined();
  });
});

describe("dolna linia kafelka: dokąd pójdzie albo poszło (paczka 7)", () => {
  const clickup = { type: "draft", target: { app: "clickup", action: "create", where: "PirxeyOS / Full Backlog" }, subject: "[US] Podgląd ról", body: "x", status: "proposed" } as const;
  it("szkic do zatwierdzenia pokazuje aplikację i miejsce; po wysyłce dokąd poszło, o której, z linkiem", () => {
    const s1 = step({ tool: "clickup", status: "draft", needsApproval: true, blocks: [clickup] });
    const t = task({ steps: [s1] });
    const a = stepTile(t, s1, [t]);
    expect(a.meta).toBe("ClickUp · PirxeyOS / Full Backlog"); expect(a.dest).toBe(a.meta); expect(a.destHref).toBeNull();
    const s2 = step({ tool: "clickup", status: "done", needsApproval: true, doneAt: "2026-10-20T16:52:00Z", link: "https://app.clickup.com/t/abc", blocks: [{ ...clickup, status: "sent" }] });
    const t2 = task({ steps: [s2] });
    const b = stepTile(t2, s2, [t2]);
    expect(b.meta).toBe("W ClickUpie · Full Backlog · 18:52"); expect(b.destHref).toBe("https://app.clickup.com/t/abc");
  });
  it("plik na Macu po zapisie; zrobiony krok ze zgodą bez szkicu nie ma „· zatw.”; praca w toku bez zmian", () => {
    const f = step({ tool: "file", status: "done", filePath: "~/Documents/robocze/us-access-roles-podglad.md" });
    const tf = task({ steps: [f] });
    expect(stepTile(tf, f, [tf]).meta).toBe("Plik na Macu · us-access-roles-podglad.md");
    const d = step({ tool: "slack", status: "done", needsApproval: true, estMin: 10 });
    const td = task({ steps: [d] });
    expect(stepTile(td, d, [td]).meta).toBe("Start od razu · 10 min");
    const h = step({ tool: "slack", status: "handoff", handoffAt: "2026-10-20T08:00:00Z" });
    const th = task({ steps: [h] });
    expect(stepTile(th, h, [th]).meta).toBe("Pracuje od 10:00");
    const r = step({ tool: "slack", status: "todo", needsApproval: true, estMin: 10 });
    const tr = task({ steps: [r] });
    expect(stepTile(tr, r, [tr]).meta).toBe("Start od razu · 10 min · zatw.");
  });
});
