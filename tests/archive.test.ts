import { describe, it, expect } from "vitest";
import { isArchivedDone } from "@/lib/search-core";

describe("archiwum ukończonych", () => {
  it("ukończone zadanie schodzi z kanwy po 5 minutach", () => {
    const now = Date.parse("2026-10-19T19:30:00Z");
    expect(isArchivedDone(null, now)).toBe(false);
    expect(isArchivedDone("2026-10-19T19:26:00Z", now)).toBe(false);
    expect(isArchivedDone("2026-10-19T19:25:00Z", now)).toBe(true);
  });
});
