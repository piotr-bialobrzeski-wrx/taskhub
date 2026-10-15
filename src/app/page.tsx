// Główna kanwa: zadania jako kafelki, kolejność z priorytetu efektywnego, grupy, archiwum (ukończone + kosz), dok czatu.
import { requireOwner } from "@/lib/session";
import * as repo from "@/lib/repo";
import { bundle } from "@/lib/services";
import { sortByPriority } from "@/lib/priority";
import { availableProviders } from "@/lib/ai";
import { fmtDate, taskTile } from "@/lib/canvas/vm";
import { Board, type ArchRow } from "@/components/canvas/Board";

export const dynamic = "force-dynamic";

const DAY = 864e5;

export default async function Home() {
  const o = await requireOwner();
  const [b, chatLog, groups, questions] = await Promise.all([bundle(o.id), repo.listChat(o.id, null, 2), repo.listGroups(o.id, null), repo.listQuestions(o.id, { open: true })]);
  const startOfToday = new Date().setHours(0, 0, 0, 0);
  const live = sortByPriority(b.scored.filter((s) => !s.task.deletedAt));
  // ukończone zostają na kanwie do końca dnia, potem idą do archiwum
  const onBoard = live.filter((s) => !s.task.doneAt || new Date(s.task.doneAt).getTime() >= startOfToday);
  const doneArch = live.filter((s) => s.task.doneAt && new Date(s.task.doneAt).getTime() < startOfToday).sort((a, b2) => (b2.task.doneAt ?? "").localeCompare(a.task.doneAt ?? ""));
  // kosz nie jest punktowany (scoreAll pomija usunięte), więc priorytet = ustawiony
  const trash = b.tasks.filter((t) => t.deletedAt).sort((a, b2) => (b2.deletedAt ?? "").localeCompare(a.deletedAt ?? ""))
    .map((t) => ({ task: t, score: { base: t.level, eff: t.level, why: [] }, project: b.projects.find((p) => p.id === t.projectId) ?? null }));
  const qCount = new Map<string, number>();
  questions.forEach((q) => qCount.set(q.taskId, (qCount.get(q.taskId) ?? 0) + 1));
  const all = b.tasks;
  const providers = availableProviders();
  const lastAgent = [...chatLog].reverse().find((m) => m.role === "agent");
  const row = (s: (typeof live)[number], when: string): ArchRow => ({ id: s.task.id, title: s.task.title, when, summary: s.task.noteSummary ?? (s.task.summary || null), base: s.score.base, eff: s.score.eff, project: s.project?.name ?? null });

  return (
    <Board
      tasks={onBoard.map((s) => taskTile(s, all, qCount.get(s.task.id) ?? 0))}
      groups={groups.map((g) => ({ id: g.id, name: g.name, color: g.color, x: g.x, y: g.y, w: g.w, h: g.h, members: g.members, auto: g.auto }))}
      projects={b.projects.map((p) => ({ id: p.id, name: p.name, color: p.color }))}
      aiOn={providers.length > 0}
      agent={providers.length ? (providers[0] === "anthropic" ? "Claude" : "GPT") : "Claude · konektor"}
      lastAgent={lastAgent ? { id: lastAgent.id, text: lastAgent.text } : null}
      archive={{
        done: doneArch.map((s) => row(s, `ukończone ${fmtDate(s.task.doneAt!)}`)),
        trash: trash.map((s) => row(s, `w koszu, zniknie za ${Math.max(1, Math.ceil((new Date(s.task.deletedAt!).getTime() + repo.TRASH_DAYS * DAY - Date.now()) / DAY))} dni`)),
        trashDays: repo.TRASH_DAYS,
      }}
    />
  );
}
