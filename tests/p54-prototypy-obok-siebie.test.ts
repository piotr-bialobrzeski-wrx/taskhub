// paczka 54: drugi prototyp w osobnym katalogu roboczym (git worktree), gdy zmiany pierwszego czekają na zgodę
import { describe, it, expect } from "vitest";
import { bridgeWorkPrompt } from "@/lib/bridge";

describe("paczka 54: prototypy obok siebie", () => {
  it("polecenie każe zrobić git worktree zamiast czekać na zgodę innego szkicu", () => {
    const p = bridgeWorkPrompt();
    expect(p).toMatch(/git worktree add/);
    expect(p).toMatch(/nie czekaj na nią/);
  });
  it("repozytorium z git ls-remote --get-url, bo git remote jest zablokowany", () => {
    const p = bridgeWorkPrompt();
    expect(p).toMatch(/git ls-remote --get-url origin/);
    expect(p).not.toMatch(/git remote get-url/);
  });
});
