// Ochrona logowania: limity nieudanych prób i nocna blokada. Część z bazą pomijana bez TEST_DATABASE_URL.
import { beforeEach, describe, expect, it } from "vitest";
import { sql } from "@/lib/db";
import { GLOBAL_LIMIT, IP_LIMIT, guardMessage, lockUntil, mayTry, record } from "@/lib/guard";

const DB = !!process.env.TEST_DATABASE_URL;
const c = (ip: string) => ({ ip, ua: "test", country: null });

describe("ochrona logowania: blokada nocna i komunikaty", () => {
  beforeEach(() => { process.env.TASKHUB_LOCK_UNTIL = ""; });

  it("blokada nocna działa do wskazanej chwili, potem znika", () => {
    process.env.TASKHUB_LOCK_UNTIL = "2026-10-20T05:00:00Z";
    expect(lockUntil(new Date("2026-10-19T23:00:00Z"))?.toISOString()).toBe("2026-10-20T05:00:00.000Z");
    expect(lockUntil(new Date("2026-10-20T05:00:01Z"))).toBeNull();
  });

  it("w czasie blokady nawet poprawne hasło nie jest sprawdzane", async () => {
    process.env.TASKHUB_LOCK_UNTIL = "2026-10-20T05:00:00Z";
    const v = await mayTry("1.1.1.1", new Date("2026-10-19T23:00:00Z"));
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.reason).toBe("lock");
  });

  it("komunikaty pod polem hasła", () => {
    expect(guardMessage("lock", "07:00")).toBe("Logowanie jest wstrzymane do 07:00 (ochrona na noc).");
    expect(guardMessage("rate", "<b>")).toBe("Za dużo nieudanych prób. Spróbuj później.");
    expect(guardMessage(undefined, undefined)).toBeNull();
  });
});

describe.skipIf(!DB)("ochrona logowania: limity prób", () => {
  beforeEach(async () => { process.env.TASKHUB_LOCK_UNTIL = ""; await sql()`delete from login_events`; });

  it("po 5 złych hasłach z jednego IP to IP czeka, inne nie", async () => {
    for (let i = 0; i < IP_LIMIT; i++) await record("web", false, c("2.2.2.2"));
    const v = await mayTry("2.2.2.2");
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.reason).toBe("rate");
    expect((await mayTry("3.3.3.3")).ok).toBe(true);
  });

  it("udane logowania nie liczą się do limitu", async () => {
    for (let i = 0; i < IP_LIMIT + 2; i++) await record("web", true, c("4.4.4.4"));
    expect((await mayTry("4.4.4.4")).ok).toBe(true);
  });

  it("zgadywanie z wielu IP zatrzymuje limit wspólny", async () => {
    for (let i = 0; i < GLOBAL_LIMIT; i++) await record("oauth", false, c(`10.0.0.${i}`));
    const v = await mayTry("9.9.9.9");
    expect(v.ok).toBe(false);
  });

  it("limit wspólny nie blokuje prób z Polski (boty nie zablokują Piotra)", async () => {
    for (let i = 0; i < GLOBAL_LIMIT; i++) await record("web", false, c(`10.0.1.${i}`));
    expect((await mayTry("9.9.9.8", new Date(), "PL")).ok).toBe(true);
    expect((await mayTry("9.9.9.8", new Date(), "US")).ok).toBe(false);
  });
});

describe.skipIf(!DB)("raport bezpieczeństwa", () => {
  it("zbiera tokeny, mostki i próby logowania bez sekretów", async () => {
    const { securityReport } = await import("@/lib/security");
    const { ensureOwner } = await import("@/lib/repo");
    const o = await ensureOwner();
    await record("web", false, c("5.5.5.5"));
    const r = await securityReport(o.id);
    expect(r.logins.some((l) => l.ip === "5.5.5.5" && l.ok === false)).toBe(true);
    expect(JSON.stringify(r)).not.toMatch(/token_hash|secret_hash/);
  });
});
