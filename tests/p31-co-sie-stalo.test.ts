// Paczka 31: wariant C dymków „po uwagach”. Zdarzenia agenta nie stoją stosem dymków nad pigułką: pigułka ma licznik „N nowe”,
// a rozwinięty panel kolejki listę „Co się stało” z „Wyczyść”. To, co czeka na Piotra, idzie na górę i zostaje po „Wyczyść”.
import { describe, it, expect } from "vitest";
import { agentFeed, stepWaits, type FeedItem } from "@/lib/feed";
import { afterClear, eventOrder } from "@/components/canvas/Queue";
import type { ChatMessage } from "@/lib/repo";

const msg = (id: string, actions: Record<string, unknown> | null = null, minAgo = 1): ChatMessage =>
  ({ id, role: "agent", text: `Zdarzenie ${id}`, actions, createdAt: new Date(Date.now() - minAgo * 60_000).toISOString(), seenAt: null, answeredAt: null });

describe("Co się stało: zdarzenia", () => {
  it("zdarzenie kroku, który czeka na Piotra, ma need; reszta nie", () => {
    const waiting = (id: string) => id === "s-decyzja";
    const [a, b, c] = agentFeed([msg("a", { stepId: "s-decyzja" }), msg("b", { stepId: "s-zrobiony" }), msg("c")], Date.now(), waiting);
    expect(a.need).toBe(true);
    expect(b.need).toBe(false);
    expect(c.need).toBe(false);
    // odpowiedź z kanwy prowadząca do kroku też liczy się po kroku
    expect(agentFeed([msg("d", { taskId: "t1", stepId: "s-decyzja", label: "03" })], Date.now(), waiting)[0]).toMatchObject({ need: true, open: { label: "Otwórz krok 03" } });
  });
  it("lista ma więcej niż trzy dawne dymki, bez wczorajszych", () => {
    const log = Array.from({ length: 10 }, (_, i) => msg(`m${i}`));
    expect(agentFeed(log)).toHaveLength(8);
    expect(agentFeed([msg("stare", null, 13 * 60)])).toHaveLength(0);
  });
  it("krok czeka na Piotra: jego otwarty krok albo szkic do zgody; nie zrobiony i nie w pracy w chmurze", () => {
    expect(stepWaits({ status: "todo", tool: "manual" })).toBe(true);
    expect(stepWaits({ status: "draft", tool: "slack" })).toBe(true);
    expect(stepWaits({ status: "todo", tool: "claude" })).toBe(false);
    expect(stepWaits({ status: "done", tool: "manual" })).toBe(false);
    expect(stepWaits({ status: "handoff", tool: "manual" })).toBe(false);
    expect(stepWaits(undefined)).toBe(false);
  });
  it("kolejność: najpierw to, co czeka na Piotra, potem najnowsze; „Wyczyść” zostawia tylko czekające", () => {
    const e = (id: string, need = false): FeedItem => ({ id, text: id, at: "08:00", stepId: null, link: null, steps: [], need });
    const list = [e("stare"), e("decyzja", true), e("nowe")];
    expect(eventOrder(list).map((x) => x.id)).toEqual(["decyzja", "nowe", "stare"]);
    expect(afterClear(list)).toEqual(["decyzja"]);
  });
});
