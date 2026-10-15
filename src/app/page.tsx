// Główna kanwa: zadania posortowane priorytetem efektywnym, grupy od agenta, ukończone, kosz, czat.
import Link from "next/link";
import { requireOwner } from "@/lib/session";
import * as repo from "@/lib/repo";
import { bundle } from "@/lib/services";
import { sortByPriority, dueLeftH } from "@/lib/priority";
import { fmtMin, remainCal, remainEst, taskSpent, todayISO, WORK_HOURS } from "@/lib/time";
import { taskState, type Scored } from "@/lib/agent/context";
import { Prio } from "@/components/Prio";
import { ChatBar } from "@/components/ChatBar";
import { PendingButton } from "@/components/Pending";
import { chat, logout, purgeTaskAction, restoreTask } from "./actions";
import type { TimeSample } from "@/lib/schema";

export const dynamic = "force-dynamic";

function TaskRow({ s, samples }: { s: Scored; samples: TimeSample[] }) {
  const t = s.task;
  const done = t.steps.filter((x) => x.status === "done").length;
  const left = t.due ? dueLeftH(t.due) : null;
  const lateCls = left == null ? "" : left < 0 ? " late" : left < 48 ? " draft" : "";
  const state = taskState(t);
  return (
    <Link href={`/tasks/${t.id}`} className={"task-row" + (t.doneAt ? " done" : "")}>
      <Prio score={s.score} />
      <div>
        <div className="t">{t.title}</div>
        <div className="meta">
          <span className={"st " + (state === "ukończone" ? "done" : state === "do zatwierdzenia" ? "draft" : state === "w Claude" ? "handoff" : state === "w toku" ? "ready" : "")}>{state}</span>
          {s.project ? <span className={"chip pc-" + s.project.color}><span className="d" />{s.project.name}</span> : null}
          {t.due ? <span className={"st" + lateCls}>termin {t.due}</span> : null}
          <span>kroki {done}/{t.steps.length}</span>
          {t.doneAt ? null : <span>zostało ~{fmtMin(remainCal(t, samples))}</span>}
          {taskSpent(t) ? <span>zrobione {fmtMin(taskSpent(t))}</span> : null}
        </div>
      </div>
      <span className="sub" style={{ whiteSpace: "nowrap" }}>{t.noteSummary ? "✓ " + t.noteSummary.slice(0, 80) : ""}</span>
    </Link>
  );
}

export default async function Home() {
  const o = await requireOwner();
  const [b, chatLog, groups] = await Promise.all([bundle(o.id), repo.listChat(o.id, null, 2), repo.listGroups(o.id, null)]);
  const live = sortByPriority(b.scored.filter((s) => !s.task.deletedAt));
  const open = live.filter((s) => !s.task.doneAt);
  const done = live.filter((s) => s.task.doneAt);
  const trash = b.tasks.filter((t) => t.deletedAt);
  const today = todayISO();
  const dueToday = open.filter((s) => s.task.due && s.task.due <= today);
  const totalLeft = open.reduce((a, s) => a + remainCal(s.task, b.samples), 0);
  const rawLeft = open.reduce((a, s) => a + remainEst(s.task), 0);
  const lastAgent = [...chatLog].reverse().find((m) => m.role === "agent");
  const byId = new Map(live.map((s) => [s.task.id, s]));

  return (
    <main className="app">
      <div className="top">
        <h1>Task Hub</h1>
        <span className="sub">{open.length} otwartych{open.length ? ` · ~${fmtMin(totalLeft)}${totalLeft !== rawLeft ? ` (szacunki ${fmtMin(rawLeft)})` : ""} · ok. ${Math.ceil(totalLeft / 60 / WORK_HOURS)} dni` : ""}</span>
        <span className="sp" />
        <Link className="pill" href="/rules">Zasady</Link>
        <Link className="pill" href="/settings">Ustawienia</Link>
        <form action={logout}><button className="pill" type="submit">Wyloguj</button></form>
      </div>

      {dueToday.length ? <div className="note" style={{ marginBottom: 12 }}>Na dziś lub po terminie: {dueToday.map((s) => s.task.title).join(", ")}.</div> : null}

      {groups.map((g) => {
        const members = g.members.map((id) => byId.get(id)).filter((s): s is Scored => !!s && !s.task.doneAt);
        if (!members.length) return null;
        return (
          <section key={g.id} className="group" style={{ marginBottom: 12 }}>
            <h3>{g.name} · ~{fmtMin(members.reduce((a, s) => a + remainCal(s.task, b.samples), 0))}</h3>
            {members.map((s) => <TaskRow key={s.task.id} s={s} samples={b.samples} />)}
          </section>
        );
      })}

      <div className="stack">
        {open.length ? open.map((s) => <TaskRow key={s.task.id} s={s} samples={b.samples} />) : <div className="card sub">Brak otwartych zadań.</div>}
      </div>

      {done.length ? (
        <details className="edit" style={{ marginTop: 20 }}>
          <summary>Ukończone ({done.length})</summary>
          <div className="stack">{done.map((s) => <TaskRow key={s.task.id} s={s} samples={b.samples} />)}</div>
        </details>
      ) : null}

      {trash.length ? (
        <details className="edit" style={{ marginTop: 12 }}>
          <summary>Kosz ({trash.length}), znika po {repo.TRASH_DAYS} dniach</summary>
          <div className="stack">
            {trash.map((t) => (
              <div key={t.id} className="row card" style={{ padding: "8px 16px" }}>
                <span style={{ flex: 1 }}>{t.title}</span>
                <form action={restoreTask.bind(null, t.id)}><PendingButton>Przywróć</PendingButton></form>
                <form action={purgeTaskAction.bind(null, t.id)}><PendingButton className="pill danger">Usuń na zawsze</PendingButton></form>
              </div>
            ))}
          </div>
        </details>
      ) : null}

      {lastAgent ? <div className="reply note" style={{ marginTop: 20 }}><span className="lbl">Agent</span>{lastAgent.text}</div> : null}

      <ChatBar action={chat} placeholder={b.tasks.length ? "Co wpadło? Albo: mam 1,5 h, co robić?" : "Wklej wiadomość albo opisz sprawę, agent założy zadanie"} />
    </main>
  );
}
