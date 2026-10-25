// Główna kanwa: zadania jako kafelki, kolejność z priorytetu efektywnego, grupy, archiwum (ukończone + kosz), dok czatu.
import { agentFeed } from "@/lib/feed";
import { requireOwner } from "@/lib/session";
import * as repo from "@/lib/repo";
import { bundle } from "@/lib/services";
import { sortByPriority } from "@/lib/priority";
import { availableProviders } from "@/lib/ai";
import { dueOf, fmtDate, taskStateOf, taskTile } from "@/lib/canvas/vm";
import { remainEst, taskSpent } from "@/lib/time";
import type { ProjTask } from "@/components/canvas/ui";
import { Board, type ArchRow, type BoardInitial } from "@/components/canvas/Board";
import { agentLabel, indexFrom } from "@/lib/search";
import { ARCHIVE_AFTER_MS, isArchivedDone } from "@/lib/search-core";
import { BRIDGE_ALIVE_MS } from "@/lib/bridge";
import { liveActivity, liveKey } from "@/lib/live";
import { LivePoll } from "@/components/LivePoll";
import { agentQueue } from "@/lib/agent/work";

export const dynamic = "force-dynamic";

const DAY = 864e5;

export default async function Home({ searchParams }: { searchParams: Promise<BoardInitial> }) {
  const initial = await searchParams;
  const o = await requireOwner();
  const [b, chatLog, groups, questions, bridge, stamp, pending] = await Promise.all([bundle(o.id), repo.listChat(o.id, null, 8), repo.listGroups(o.id, null), repo.listQuestions(o.id, { open: true }), repo.bridgeStatus(o.id, BRIDGE_ALIVE_MS), repo.changeStamp(o.id, null), repo.countPendingChat(o.id)]);
  const run = liveActivity(bridge.run);
  const aq = await agentQueue(o.id, run ? { taskId: run.taskId, stepId: run.stepId, since: run.since, kind: run.kind } : null);
  const now = Date.now();
  const live = sortByPriority(b.scored.filter((s) => !s.task.deletedAt));
  // ukończone zostają na kanwie do końca dnia, potem idą do archiwum (ta sama reguła co w indeksie szukajki)
  const onBoard = live.filter((s) => !isArchivedDone(s.task.doneAt, now));
  const archiveAt = onBoard.reduce<number | null>((m, s) => { if (!s.task.doneAt) return m; const at = new Date(s.task.doneAt).getTime() + ARCHIVE_AFTER_MS; return m == null || at < m ? at : m; }, null);
  const doneArch = live.filter((s) => isArchivedDone(s.task.doneAt, now)).sort((a, b2) => (b2.task.doneAt ?? "").localeCompare(a.task.doneAt ?? ""));
  // kosz nie jest punktowany (scoreAll pomija usunięte), więc priorytet = ustawiony
  const trash = b.tasks.filter((t) => t.deletedAt).sort((a, b2) => (b2.deletedAt ?? "").localeCompare(a.deletedAt ?? ""))
    .map((t) => ({ task: t, score: { base: t.level, eff: t.level, why: [] }, project: b.projects.find((p) => p.id === t.projectId) ?? null }));
  const qCount = new Map<string, number>();
  questions.forEach((q) => qCount.set(q.taskId, (qCount.get(q.taskId) ?? 0) + 1));
  const all = b.tasks;
  const providers = availableProviders();
  const row = (s: (typeof live)[number], when: string): ArchRow => ({ id: s.task.id, title: s.task.title, when, summary: s.task.noteSummary ?? (s.task.summary || null), base: s.score.base, eff: s.score.eff, project: s.project?.name ?? null });
  // widok „Projekty”: wszystkie żywe zadania (także ukończone) z pozostałym szacunkiem i zmierzonym czasem
  const projTasks: ProjTask[] = live.map((s) => ({ id: s.task.id, title: s.task.title, state: taskStateOf(s.task, all), base: s.score.base, eff: s.score.eff, due: dueOf(s.task.due), remain: remainEst(s.task), spent: taskSpent(s.task), projectId: s.task.projectId }));

  return (
    <>
    <LivePoll taskId={null} liveKey={liveKey(stamp, bridge.run, bridge.alive)} active={!!run || pending.size > 0} refreshAt={archiveAt} />
    <Board
      tasks={onBoard.map((s) => taskTile(s, all, qCount.get(s.task.id) ?? 0, run, pending.get(s.task.id) ?? 0))}
      groups={groups.map((g) => ({ id: g.id, name: g.name, color: g.color, x: g.x, y: g.y, w: g.w, h: g.h, members: g.members, auto: g.auto }))}
      projects={b.projects.map((p) => ({ id: p.id, name: p.name, color: p.color, weight: p.weight, language: p.language, companyId: p.companyId }))}
      companies={b.companies.map((c) => ({ id: c.id, name: c.name, sphere: c.sphere, note: c.note, ended: !!c.endedAt }))}
      projTasks={projTasks}
      index={indexFrom(b, now)} initial={{ view: initial.view, p: initial.p, t: initial.t, focus: initial.focus }}
      aiOn={providers.length > 0}
      agent={agentLabel(providers)}
      feed={agentFeed(chatLog)}
      agentQueue={aq}
      archive={{
        done: doneArch.map((s) => row(s, `ukończone ${fmtDate(s.task.doneAt!)}`)),
        trash: trash.map((s) => row(s, `w koszu, zniknie za ${Math.max(1, Math.ceil((new Date(s.task.deletedAt!).getTime() + repo.TRASH_DAYS * DAY - Date.now()) / DAY))} dni`)),
        trashDays: repo.TRASH_DAYS,
      }}
    />
    </>
  );
}
