// paczka 53: szkic „Opublikuj prototyp” (action publish): commit, push i skrypt publikacji z repozytorium po zgodzie
import { describe, it, expect } from "vitest";
import type { Block } from "@/lib/schema";
import { DraftBlock } from "@/lib/schema";
import { isGitDraft, type Draft } from "@/lib/agent/approval";
import { gitSend, publishScript, bridgeWorkPrompt } from "@/lib/bridge";
import { approveLabel, destHint, destOf, doneChat, sentWord } from "@/lib/stepcard";

const DIFF = "@@ -0,0 +1 @@\n+# Prototyp: employees-list";
const changes = (branch = "piotr-bialobrzeski/prototype/employees-list"): Block => ({ type: "changes", repo: "simpleroseinc/shiftwow-ui", branch, files: [{ path: "PROTOTYPE.md", diff: DIFF }] });
const draft = (o: Partial<Draft> = {}): Draft => DraftBlock.parse({ type: "draft", target: { app: "github", action: "publish", where: "simpleroseinc/shiftwow-ui" }, body: "prototype: employees-list snapshot", ...o }) as Draft;

describe("paczka 53: publikacja prototypu", () => {
  it("szkic publish to szkic gita z pushem i domyślnym skryptem", () => {
    const d = draft();
    expect(isGitDraft(d, [changes()])).toBe(true);
    expect(gitSend([changes()], d)).toMatchObject({ repo: "simpleroseinc/shiftwow-ui", push: true, publish: "scripts/prototype/publish.mjs", files: ["PROTOTYPE.md"] });
  });
  it("skrypt z pola szkicu, tylko .mjs/.js w repozytorium", () => {
    expect(publishScript(draft({ fields: [{ label: "Skrypt publikacji", value: "./tools/deploy.mjs" }] }))).toBe("tools/deploy.mjs");
    expect(publishScript(draft({ fields: [{ label: "Skrypt publikacji", value: "../x.mjs" }] }))).toBeNull();
    expect(publishScript(draft({ fields: [{ label: "script", value: "deploy.sh" }] }))).toBeNull();
    expect(gitSend([changes()], draft({ fields: [{ label: "Skrypt publikacji", value: "/etc/x.js" }] }))).toMatch(/Skrypt publikacji/);
  });
  it("nigdy z gałęzi wspólnej", () => {
    expect(gitSend([changes("develop")], draft())).toMatch(/gałęzi wspólnej/);
    expect(gitSend([changes("prototypes")], draft())).toMatch(/gałęzi wspólnej/);
  });
  it("karta kroku mówi o publikacji prototypu", () => {
    const s = { tool: "code" as const, title: "Opublikuj prototyp listy pracowników", blocks: [changes(), draft()] };
    const d = destOf(s);
    expect(d?.kind).toBe("publish");
    expect(approveLabel(d, { stays: false, rows: false })).toBe("Zatwierdź i opublikuj prototyp");
    expect(destHint(d)).toMatch(/publikacja prototypu/);
    expect(sentWord(d!)).toBe("Opublikowano prototyp");
    expect(doneChat(s, false)).toMatch(/^Opublikowałem prototyp/);
  });
  it("polecenie biegu pracy opisuje procedurę prototypu", () => {
    const p = bridgeWorkPrompt();
    expect(p).toMatch(/action "publish"/);
    expect(p).toMatch(/git fetch origin \(dozwolony\)/);
  });
});
