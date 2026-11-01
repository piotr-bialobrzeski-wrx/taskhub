import { describe, it, expect } from "vitest";
import { blockUrls, linkPlan, normUrl } from "@/lib/stepcard";
import type { Block } from "@/lib/schema";

const P = "https://claude.ai/artifact/HK1gFHXMrAueQm68Xz6v9r";
describe("paczka 33: link stoi raz, w klocku, którego dotyczy", () => {
  it("adresy porównuje bez końcowego ukośnika i kotwicy", () => {
    expect(normUrl(P + "/#x")).toBe(P);
  });
  it("1. kartka decyzji z prototypem: okienko albo pytanie trzyma adres, klocek link i „Otwórz link” znikają", () => {
    const blocks = [{ type: "link", links: [{ url: P, title: "Prototyp" }] }] as Block[];
    const plan = linkPlan(blocks, [P]);
    expect(plan.keep(P)).toBe(false);                 // link kroku decyzji w rzędzie akcji
    expect(plan.linkHide()).toContain(P);             // klocek link
    expect(plan.hide).toContain(P);
  });
  it("2. krok prototypu: „Otwórz prototyp” w nagłówku, link kroku w rzędzie akcji już nie", () => {
    const plan = linkPlan([], []);
    expect(plan.keep(P)).toBe(true);
    expect(plan.keep(P + "/")).toBe(false);
  });
  it("3. szkic bez adresu celu: karta publikacji ma przycisk, nagłówek klocka źródła już nie", () => {
    const u = "https://app.clickup.com/t/869abc123";
    const blocks = [{ type: "free", markdown: "x", source: { app: "clickup", url: u } }] as Block[];
    const plan = linkPlan(blocks, [u]);
    expect(plan.hide).toContain(u);
    // bez karty publikacji (nagłówek „Teraz”): wygrywa klocek źródła
    expect(linkPlan(blocks, []).keep(u)).toBe(false);
  });
  it("4. zrobiony krok bez linku do wyniku: miejsce kroku stoi już w klocku wyniku", () => {
    const u = "https://slack.com/archives/C1/p1";
    const blocks = [{ type: "thread", messages: [], source: { app: "slack", url: u } }] as unknown as Block[];
    expect(blockUrls(blocks)).toEqual([u]);
    expect(linkPlan(blocks, []).keep(u)).toBe(false);
  });
  it("5. blok zmian z podglądem: „Otwórz podgląd” tylko w klocku", () => {
    const u = "https://taskhub-git-x.vercel.app";
    const blocks = [{ type: "changes", files: [], preview: u }] as unknown as Block[];
    const plan = linkPlan(blocks, []);
    expect(plan.keep(u)).toBe(false);
    expect(plan.keep("https://github.com/a/b")).toBe(true);   // „Repozytorium” zostaje
  });
});
