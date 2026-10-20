// Paczka 7, punkt 4.7: nietknięty szkic zatwierdza się bajt w bajt; poprawiony zapisuje się z poprawką; zmieniony po wyświetleniu nie zatwierdza się.
import { describe, it, expect, beforeAll, vi } from "vitest";
import type { Block } from "@/lib/schema";

vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));
vi.mock("@/lib/session", async (orig) => ({ ...(await orig<typeof import("@/lib/session")>()), requireOwner: async () => (await import("@/lib/repo")).ensureOwner() }));

const BODY = "## Opis\n\nAccess & roles dla <@U07DWN21HJQ>\n\n| Rola | Zakres |\n| --- | --- |\n| Admin | wszystko |\n\n- [ ] a\n- [x] b\n\n---\n\n```\nx &amp; y\n```";

describe.skipIf(!process.env.TEST_DATABASE_URL)("zgoda na szkic z karty", async () => {
  const repo = await import("@/lib/repo");
  const { sql } = await import("@/lib/db");
  const actions = await import("@/app/actions");
  const { approvalSig, shownSig, draftOf } = await import("@/lib/agent/approval");
  let owner = "";
  const draft = (body: string): Block => ({ type: "draft", target: { app: "slack", where: "#dev", action: "send" }, body, status: "proposed" });
  const proposed = async (body: string) => {
    const t = await repo.createTask(owner, { title: "Szkic " + body.length, steps: [{ title: "Napisz na #dev", tool: "slack", needsApproval: true }] });
    await repo.updateStep(t.steps[0].id, { status: "draft", blocks: [draft(body)] });
    const s = (await repo.getTask(owner, t.id))!.steps[0];
    return { taskId: t.id, s, d: draftOf(s)! };
  };
  const get = async (taskId: string, stepId: string) => (await repo.getTask(owner, taskId))!.steps.find((x) => x.id === stepId)!;
  beforeAll(async () => {
    owner = (await repo.ensureOwner()).id;
    await sql()`delete from tasks where owner_id = ${owner} and title like 'Szkic %'`;
    // zgoda na szkic do Slacka wymaga konektora Slack na Macu (paczka 7, punkt 4.5)
    await sql()`delete from connections where owner_id = ${owner}`;
    await repo.upsertBridgeConnections(owner, "Mac", [{ name: "claude.ai Slack", ok: true }]);
  });

  it("bez poprawki: formularz nie niesie treści, zgoda obejmuje pełny podpis i treść zostaje bajt w bajt", async () => {
    const { taskId, s, d } = await proposed(BODY);
    const fd = new FormData(); fd.set("seen", shownSig(s, d, true)); fd.set("seenFull", shownSig(s, d, false));
    await actions.approveStep(taskId, s.id, fd);
    const after = await get(taskId, s.id);
    expect(after.status).toBe("handoff");
    expect(draftOf(after)).toMatchObject({ body: BODY, status: "approved" });
    expect(after.approvedSig).toBe(approvalSig(after, draftOf(after)!));
    expect(repo.isSendable(after)).toBe(true);
  });
  it("agent zmienił treść po wyświetleniu karty: bez zgody, a rozmowa mówi, że szkic się zmienił", async () => {
    const { taskId, s, d } = await proposed(BODY);
    const fd = new FormData(); fd.set("seen", shownSig(s, d, true)); fd.set("seenFull", shownSig(s, d, false));
    await repo.updateStep(s.id, { blocks: [draft(BODY + "\n\nPS")] });
    await actions.approveStep(taskId, s.id, fd);
    const after = await get(taskId, s.id);
    expect(after.status).toBe("draft"); expect(after.approvedAt).toBeNull();
    const [m] = await sql()`select text from chat_messages where task_id = ${taskId} order by created_at desc limit 1`;
    expect(m.text).toContain("szkic zmienił się");
  });
  it("z poprawką: treść z formularza, podpis bez treści", async () => {
    const { taskId, s, d } = await proposed(BODY);
    const fd = new FormData(); fd.set("body", "Access & roles, wersja Piotra"); fd.set("seen", shownSig(s, d, true)); fd.set("seenFull", shownSig(s, d, false));
    await actions.approveStep(taskId, s.id, fd);
    const after = await get(taskId, s.id);
    expect(draftOf(after)).toMatchObject({ body: "Access & roles, wersja Piotra", status: "approved" });
    expect(repo.isSendable(after)).toBe(true);
  });
});
