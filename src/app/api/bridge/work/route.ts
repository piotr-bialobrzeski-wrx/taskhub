// Puls mostka i pytanie „czy czeka praca?”: tani odczyt bez modelu, wołany co kilkanaście sekund z komputera Piotra.
// v2 (aplikacja 0.1.7): osobno work (praca bez wysyłek) i sends (zatwierdzone szkice do wysłania, kroki przed nimi zrobione); pending = jedno i drugie.
// cloud (paczka 13): kroki do odpalenia w chmurze; cloudToRing to jedno małe zapytanie, poza pamięcią podręczną listy pracy (odpalenie ma być od razu)
import { createHash } from "node:crypto";
import * as repo from "@/lib/repo";
import { listSendable, workSummary } from "@/lib/agent/work";
import { cpuLog, cpuStart } from "@/lib/cpu";
import { liveConfig, realtimeSocket } from "@/lib/live-signal";
import { BRIDGE_ALIVE_MS, BRIDGE_VERSION, CLOUD_TRIGGER, RING_AGAIN_MIN, RUN_STALE_MIN, authBridge, pollMs, protocolOf } from "@/lib/bridge";

export const dynamic = "force-dynamic";

// Pełna lista pracy czyta całą bazę zadań z krokami (setki KB), a mostek pyta co 15 s z każdego Maca. Wynik trzymamy w pamięci
// instancji i liczymy od nowa tylko, gdy zmieni się odcisk bazy (repo.workStamp, jeden mały wiersz) albo minie CACHE_MS
// (to, co zależy od samego czasu, np. wiadomość wzięta, ale bez odpowiedzi). Zimna instancja = jedno pełne liczenie, jak dotąd.
const CACHE_MS = 10 * 60_000;
const LIVE_SAFE_MS = 5 * 60_000;   // paczka 60: przy działającym sygnale mostek pyta sam najwyżej co 5 min (rzeczy zależne od czasu)   // paczka 60: było 5 min; pełne liczenie to najdroższa część pytania mostka
type Cached = { stamp: string; at: number; work: number; counts: Record<string, number>; key: string; sends: number };
const cache = new Map<string, Cached>();

async function cached(ownerId: string, proto: number, compute: () => Promise<Omit<Cached, "stamp" | "at">>): Promise<Cached> {
  const id = `${ownerId}|${proto}`;
  const stamp = await repo.workStamp(ownerId);
  const hit = cache.get(id);
  if (hit && hit.stamp === stamp && Date.now() - hit.at < CACHE_MS) return hit;
  const c = { ...(await compute()), stamp, at: Date.now() };
  cache.set(id, c);
  return c;
}

// paczka 60: pytanie mostka zapisywało w bazie przy każdym wywołaniu (puls, meta, odcisk dostępu, sprzątanie biegów).
// Puls (seen_at) zapisuje już authBridge; resztę robimy tylko, gdy coś się zmieniło albo minęła minuta (pamięć instancji).
const ONCE_MS = 60_000;
const lastMeta = new Map<string, { v: string; at: number }>();
const lastAccess = new Map<string, string>();
const lastExpire = new Map<string, number>();
const stale = (m: Map<string, number>, k: string) => { const t = m.get(k) ?? 0; if (Date.now() - t < ONCE_MS) return false; m.set(k, Date.now()); return true; };

export async function GET(req: Request) {
  const t0 = cpuStart();
  const a = await authBridge(req);
  if (a instanceof Response) return a;
  const q = new URL(req.url).searchParams;
  const meta: Record<string, string> = {};
  // codex: stan Codex CLI na Macu (ready, auth, missing; aplikacja 0.1.20+), od niego zależy, czy przełącznik GPT kieruje tam pracę
  for (const k of ["host", "runner", "state", "until", "v", "codex"]) { const v = q.get(k); if (v) meta[k] = v.slice(0, 120); }
  if (meta.state && meta.state !== "check" && !meta.until) meta.until = "";   // stary termin po limicie nie zostaje w meta, gdy mostek już go nie zgłasza
  const mv = JSON.stringify(meta), pm = lastMeta.get(a.tokenId);
  if (!pm || pm.v !== mv || Date.now() - pm.at >= ONCE_MS) { await repo.bridgeSeen(a.tokenId, meta); lastMeta.set(a.tokenId, { v: mv, at: Date.now() }); }
  // odcisk folderów i narzędzi z Ustawień aplikacji (0.1.17+): zmiana oddaje do pracy kroki, które agent oddał z braku dostępu (paczka 22)
  const access = q.get("access");
  if (access && /^[0-9a-f]{1,32}$/.test(access)) {
    const host = (meta.host || "mac").slice(0, 80), ak = `${a.ownerId}|${host}`;
    if (lastAccess.get(ak) !== access) { await repo.recordBridgeAccess(a.ownerId, host, access); lastAccess.set(ak, access); }
  }
  if (stale(lastExpire, a.ownerId)) await repo.expireBridgeRuns(a.ownerId, RUN_STALE_MIN);
  if (protocolOf(q.get("v")) < 2) {
    // v1 bez zmian: zatwierdzone szkice liczą się do pracy, wysyła je ten sam bieg
    const [c, st] = await Promise.all([
      cached(a.ownerId, 1, async () => { const w = await workSummary(a.ownerId, { peek: true }); return { work: w.total, counts: w.counts, key: "", sends: 0 }; }),
      repo.bridgeStatus(a.ownerId, BRIDGE_ALIVE_MS),
    ]);
    cpuLog("bridge/work", t0);
    return Response.json({ ok: true, pending: c.work, counts: c.counts, run: st.run, pollMs: pollMs(), version: 1, time: new Date().toISOString() });
  }
  const [c, st, ring, live] = await Promise.all([
    cached(a.ownerId, 2, async () => {
      const tasks = await repo.listTasks(a.ownerId);   // jedno czytanie bazy zadań na obie listy
      const [w, sends] = await Promise.all([workSummary(a.ownerId, { peek: true, audience: "work", tasks }), listSendable(a.ownerId, tasks)]);
      // key: odcisk listy pracy; ten sam po udanym biegu = bieg niczego nie ruszył (np. krok oddany przez leave_step), aplikacja nie powtarza go od razu
      const key = w.total ? createHash("sha256").update(w.text + (w.sig ?? "")).digest("hex").slice(0, 16) : "";
      return { work: w.total, counts: w.counts, key, sends: sends.length };
    }),
    repo.bridgeStatus(a.ownerId, BRIDGE_ALIVE_MS),
    repo.cloudToRing(a.ownerId, RING_AGAIN_MIN),
    liveConfig(a.ownerId),
  ]);
  // po „Zatrzymaj” w Task Hub mostek nie bierze pracy do końca przerwy (albo do wiadomości Piotra); zatwierdzone szkice wysyła dalej
  const work = st.pause ? 0 : c.work;
  cpuLog("bridge/work", t0);
  return Response.json({
    ok: true, pending: work + c.sends, work, sends: c.sends, key: work ? c.key : "", counts: { ...c.counts, approved: c.sends }, ...(st.pause ? { pause: st.pause } : {}),
    run: st.run, pollMs: pollMs(), version: BRIDGE_VERSION, time: new Date().toISOString(),
    // kroki kliknięte „Uruchom w chmurze”: aplikacja (0.1.13) odpala zaplanowane zadanie w chmurze i zgłasza to przez POST /api/bridge/cloud
    ...(ring ? { cloud: { count: ring, trigger: CLOUD_TRIGGER } } : {}),
    // paczka 60 (aplikacja 0.1.26+): kanał sygnału w chwili zmiany; mostek słucha go i pyta od razu po sygnale, a poza tym co LIVE_SAFE_MS.
    // stamp: skrót odcisku bazy; gdy zmienił się bez sygnału, aplikacja uznaje sygnał za zepsuty i wraca do pytania co pollMs
    ...(live ? { live: { socket: realtimeSocket(live.url, live.key), topic: live.topic, safeMs: LIVE_SAFE_MS } } : {}),
    stamp: createHash("sha256").update(c.stamp).digest("hex").slice(0, 12),
  });
}
