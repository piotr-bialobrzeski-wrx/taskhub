// Paczka 42: arkusz szkicu (wpisy czasu, wariant C). Rodzaje kolumn w polu sheet, edycja wierszy na karcie zapisuje się od razu
// (saveDraftRows), a formularz „Zatwierdź” niesie wiersze, które Piotr widzi: zgoda obejmuje dokładnie je (podpis karty bez wierszy).
import { describe, it, expect, beforeAll, vi } from "vitest";
import { Block as BlockSchema, type Block } from "@/lib/schema";
import { approvalSig, draftOf, parseSheetRows, shownSig, withRows, type Draft } from "@/lib/agent/approval";
import { fmtDuration, isOn, longDuration, parseDuration, parseTime, splitMulti } from "@/components/SheetDraft";

vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));
vi.mock("@/lib/session", async (orig) => ({ ...(await orig<typeof import("@/lib/session")>()), requireOwner: async () => (await import("@/lib/repo")).ensureOwner() }));

const COLUMNS = ["Projekt", "Tytuł", "Kategoria", "Tagi", "Data", "Od", "Do", "Czas trwania", "Rozliczalność"];
const SHEET = [
  { kind: "choice", required: true, options: [{ value: "ShiftWow", color: "#6B5244", recent: true }, { value: "Veloza-Cookie", color: "#E8952E" }] },
  { kind: "text", required: true },
  { kind: "choice", options: [{ value: "BA" }, { value: "Meeting" }] },
  { kind: "multi", options: [{ value: "AI" }, { value: "AI-Boost" }] },
  { kind: "date", required: true },
  { kind: "time", hidden: true },
  { kind: "time", hidden: true },
  { kind: "duration", required: true },
  { kind: "toggle", on: "Rozliczalne" },
] as const;
const ROWS = [
  ["ShiftWow", "Daily", "Meeting", "", "2026-11-02", "09:00", "09:15", "0:15", "tak"],
  ["ShiftWow", "869b4k2m1: Remove records from onboarding lists", "BA", "AI, AI-Boost", "2026-11-02", "", "", "1:15", "tak"],
];
const draft = (extra: Partial<Draft> = {}): Draft => BlockSchema.parse({
  type: "draft", target: { app: "pirxey-time", where: "Wpisy z 2 listopada", action: "create" }, body: "", columns: COLUMNS, sheet: SHEET, rows: ROWS,
  parts: [null, [{ what: "komentarz i zmiana statusu", app: "ClickUp", min: 20 }, { what: "Twoja odpowiedź w wątku", app: "Slack", min: 15 }]], ...extra,
}) as Draft;

describe("arkusz: schemat i wartości komórek", () => {
  it("szkic z sheet i parts przechodzi przez schemat bloku; nieznany rodzaj kolumny nie", () => {
    const d = draft();
    expect(d.sheet?.[8]).toMatchObject({ kind: "toggle", on: "Rozliczalne" });
    expect(d.parts?.[1]).toHaveLength(2);
    expect(BlockSchema.safeParse({ ...d, sheet: [{ kind: "slider" }] }).success).toBe(false);
    expect(BlockSchema.safeParse({ ...d, sheet: [{ kind: "choice", options: [{ value: "x", color: "red; background:url(x)" }] }] }).success).toBe(false);
  });
  it("czas trwania, godzina, lista po przecinku, przełącznik", () => {
    expect(parseDuration("1:15")).toBe(75);
    expect(parseDuration("1,5 h")).toBe(90);
    expect(parseDuration("45 min")).toBe(45);
    expect(parseDuration("1.25")).toBe(75);
    expect(parseDuration("90")).toBe(90);
    expect(parseDuration("1h 30min")).toBe(90);
    expect(parseDuration("abc")).toBeNull();
    expect(fmtDuration(75)).toBe("1:15");
    expect(longDuration(90)).toBe("1 h 30 min");
    expect(longDuration(45)).toBe("45 min");
    expect(parseTime("9")).toBe("09:00");
    expect(parseTime("930")).toBe("09:30");
    expect(parseTime("9.30")).toBe("09:30");
    expect(parseTime("25:00")).toBeNull();
    expect(splitMulti("AI, AI-Boost ,")).toEqual(["AI", "AI-Boost"]);
    expect(isOn("tak") && isOn("TAK") && !isOn("nie") && !isOn("")).toBe(true);
  });
  it("parseSheetRows: wiersze z formularza dopasowane do liczby kolumn, parts przy wierszu, śmieci odrzucone", () => {
    const r = parseSheetRows(JSON.stringify([["A", "b"], { c: ["X"], p: [{ what: "w", app: "Slack", min: 5 }, { bad: 1 }] }]), 3)!;
    expect(r.rows).toEqual([["A", "b", ""], ["X", "", ""]]);
    expect(r.parts).toEqual([null, [{ what: "w", app: "Slack", min: 5 }]]);
    expect(parseSheetRows("nie json", 3)).toBeNull();
    expect(parseSheetRows(JSON.stringify([["a", "b", "c", "d"]]), 3)).toBeNull();
    expect(parseSheetRows(JSON.stringify({ a: 1 }), 3)).toBeNull();
    expect(parseSheetRows(JSON.stringify(Array.from({ length: 101 }, () => ["x"])), 3)).toBeNull();
  });
  it("podpis karty bez wierszy (wiersze w formularzu) nie zależy od wierszy; pełny podpis tak", () => {
    const s = { id: "s1", blocks: [draft()] as Block[] };
    const d = draftOf(s)!;
    const other = withRows(d, { rows: [ROWS[0]], parts: [null] });
    expect(shownSig(s, d, false, true)).toBe(shownSig(s, other, false, true));
    expect(approvalSig(s, d)).not.toBe(approvalSig(s, other));
    expect(other.parts).toBeUndefined();   // żaden wiersz nie ma parts: pole znika
  });
});

describe("arkusz: zapis komórek i zgoda na to, co widać na karcie", async () => {
  const repo = await import("@/lib/repo");
  const actions = await import("@/app/actions");
  const { sql } = await import("@/lib/db");
  let owner = "";
  const get = async (taskId: string, stepId: string) => (await repo.getTask(owner, taskId))!.steps.find((x) => x.id === stepId)!;
  const make = async () => {
    const t = await repo.createTask(owner, { title: "Arkusz " + Math.random().toString(36).slice(2, 8), steps: [{ title: "Zatwierdź wpisy czasu z 2 listopada", tool: "claude", needsApproval: false }] });
    const sid = t.steps[0].id;
    await repo.updateStep(sid, { status: "draft", blocks: [{ type: "text", body: "Wpisy z kalendarzy i ticketów." }, { ...draft(), target: { app: "claude", action: "create" } }] });
    return { taskId: t.id, sid };
  };
  beforeAll(async () => {
    owner = (await repo.ensureOwner()).id;
    await sql()`delete from tasks where owner_id = ${owner} and title like 'Arkusz %'`;
  });

  it("saveDraftRows zapisuje poprawione wiersze z parts; śmieci i wysłany szkic nic nie zmieniają", async () => {
    const { taskId, sid } = await make();
    const next = [{ c: ROWS[1], p: [{ what: "komentarz", app: "ClickUp", min: 20 }] }, [...ROWS[0].slice(0, 7), "0:30", "nie"]];
    expect(await actions.saveDraftRows(taskId, sid, 0, JSON.stringify(next))).toBe(true);
    const d = draftOf(await get(taskId, sid))!;
    expect(d.rows).toEqual([ROWS[1], [...ROWS[0].slice(0, 7), "0:30", "nie"]]);
    expect(d.parts).toEqual([[{ what: "komentarz", app: "ClickUp", min: 20 }], null]);
    expect(d.sheet).toHaveLength(9);
    expect(await actions.saveDraftRows(taskId, sid, 0, "[[1,2,3,4,5,6,7,8,9,10]]")).toBe(false);
    expect(await actions.saveDraftRows(taskId, sid, 3, "[]")).toBe(false);
    // wszystkie wiersze usunięte: pusty arkusz zostaje szkicem z kolumnami
    expect(await actions.saveDraftRows(taskId, sid, 0, "[]")).toBe(true);
    expect(draftOf(await get(taskId, sid))!.rows).toEqual([]);
  });

  it("zatwierdzenie z wierszami z formularza: zapisane są te wiersze, a podpis karty bez wierszy przechodzi", async () => {
    const { taskId, sid } = await make();
    const s = await get(taskId, sid), d = draftOf(s)!;
    const shown = [[...ROWS[0].slice(0, 7), "0:45", "tak"]];
    const fd = new FormData(); fd.set("rows", JSON.stringify(shown)); fd.set("seenRows", shownSig(s, d, false, true)); fd.set("seenFull", shownSig(s, d, false));
    await actions.approveStep(taskId, sid, fd);
    const after = await get(taskId, sid);
    expect(after.status).toBe("done");
    expect(draftOf(after)!.rows).toEqual(shown);
  });

  it("szkic do wysłania: zgoda zapisuje wiersze z karty i podpis tych wierszy; zmiana wierszy po zgodzie ją kasuje", async () => {
    const { taskId, sid } = await make();
    await repo.updateStep(sid, { needsApproval: true, blocks: [draft()] });
    const s = await get(taskId, sid), d = draftOf(s)!;
    const shown = [ROWS[1]];
    const fd = new FormData(); fd.set("rows", JSON.stringify([{ c: ROWS[1], p: [{ what: "Slack", min: 15 }] }])); fd.set("seenRows", shownSig(s, d, false, true));
    expect(await repo.approveDraft(owner, sid, { seen: shownSig(s, d, false, true), rows: parseSheetRows(fd.get("rows"), COLUMNS.length) })).toBe(true);
    const a = await get(taskId, sid), ad = draftOf(a)!;
    expect(a.status).toBe("handoff");
    expect(ad.status).toBe("approved");
    expect(ad.rows).toEqual(shown);
    expect(a.approvedSig).toBe(approvalSig(a, ad));
    // agent zmienił szkic po wyświetleniu karty: podpis karty bez wierszy już nie pasuje (zmienione miejsce)
    const { taskId: t2, sid: s2 } = await make();
    await repo.updateStep(s2, { needsApproval: true, blocks: [draft()] });
    const b = await get(t2, s2), bd = draftOf(b)!;
    const seen = shownSig(b, bd, false, true);
    await repo.updateStep(s2, { blocks: [{ ...bd, target: { ...bd.target, where: "inny dzień" } }] });
    expect(await repo.approveDraft(owner, s2, { seen, rows: { rows: shown, parts: [null] } })).toBe(false);
  });
});
