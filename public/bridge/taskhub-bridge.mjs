#!/usr/bin/env node
// Mostek Task Hub (wzorzec z Project Hub). Ten sam mechanizm siedzi w aplikacji Task Hub na Maca; ten skrypt to wersja
// bez aplikacji (serwer, Linux, testy): odpytuje Task Hub tanim HTTP (zero tokenów), a gdy czeka praca, uruchamia
// Claude Code (`claude -p`) na subskrypcji z konektorem Task Hub i zgłasza przebieg. Bez zależności, Node 20+.
// Zasady biegu (protokół v2): tryb dontAsk z listą dozwolonych narzędzi (Task Hub, czytanie w sieci; bez terminala, zapisu plików
// i konektorów innych aplikacji), krótki token biegu od serwera w pliku 0600 (nigdy w argumentach), bez wysyłek: zatwierdzone
// szkice wysyła aplikacja Task Hub na Maca osobnym biegiem wysyłki.
//
//   TASKHUB_BRIDGE_TOKEN=th_… node taskhub-bridge.mjs --install --url https://…   # macOS: usługa launchd startująca po zalogowaniu
//   node taskhub-bridge.mjs                                          # praca w tym oknie (Ctrl-C kończy)
//   node taskhub-bridge.mjs --once | --status | --uninstall | --help
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

export const VERSION = "2";
const HOME = os.homedir();
const DIR = process.env.TASKHUB_BRIDGE_DIR || path.join(HOME, ".taskhub-bridge");
const CONFIG = path.join(DIR, "config.json");
const WORK = path.join(DIR, "work");          // katalog roboczy Claude Code: poza Dokumentami (TCC), bez cudzych ustawień projektu
const RUN_DIR = path.join(DIR, "run");        // pliki jednego biegu (konfiguracja MCP z tokenem biegu): 0600, poza katalogiem roboczym, kasowane po biegu
const LOCK = path.join(DIR, "bridge.lock");
const LABEL = "com.taskhub.bridge";
const PLIST = path.join(HOME, "Library", "LaunchAgents", `${LABEL}.plist`);
export const LOG = process.platform === "darwin" ? path.join(HOME, "Library", "Logs", "taskhub-bridge.log") : path.join(DIR, "bridge.log");
const STALL_MS = 10 * 60_000;                 // bieg bez żadnego sygnału z claude → ubijamy

// ---------- rozpoznawanie limitu i wylogowania (regresja: tests/bridge.test.ts) ----------
export const LIMIT_RE = /usage limit|rate limit|limit reached|too many requests|quota|resource[_ ]?exhausted|overloaded/i;
export const AUTH_RE = /not logged in|please run \/login|run \/login|invalid api key|authentication[_ ]?error|failed to authenticate|unauthorized|oauth token (has )?expired|refresh token is no longer valid|could not be refreshed|session expired/i;
export function parseAuth(text) { return AUTH_RE.test(String(text || "")); }
export function parseLimit(text) {
  const t = String(text || "");
  if (!LIMIT_RE.test(t)) return { limit: false, reset_at: null };
  let reset_at = null;
  const ts = t.match(/\b(1[6-9]\d{8})\b/);                       // unix seconds
  if (ts) reset_at = Number(ts[1]) * 1000;
  if (!reset_at) {
    const m = t.match(/reset[^0-9]{0,24}?(\d{1,2})(?::(\d{2}))?\s*(a\.?m\.?|p\.?m\.?)?/i);
    if (m) {
      let h = Number(m[1]); const min = Number(m[2] || 0); const ap = (m[3] || "").replace(/\./g, "").toLowerCase();
      if (ap === "pm" && h < 12) h += 12;
      if (ap === "am" && h === 12) h = 0;
      const d = new Date(); d.setHours(h, min, 0, 0);
      if (d.getTime() <= Date.now()) d.setDate(d.getDate() + 1);
      reset_at = d.getTime();
    }
  }
  return { limit: true, reset_at };
}

// ---------- konfiguracja: argumenty > zmienne środowiska > ~/.taskhub-bridge/config.json ----------
export function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) { const k = a.slice(2); out[k] = i + 1 < argv.length && !argv[i + 1].startsWith("--") ? argv[++i] : true; }
    else out._.push(a);
  }
  return out;
}
export function loadConfig(args = {}, env = process.env, file = readConfigFile()) {
  const cfg = {
    url: String(args.url || env.TASKHUB_URL || file.url || "").replace(/\/$/, ""),
    token: String(args.token || env.TASKHUB_BRIDGE_TOKEN || file.token || ""),
    name: String(args.name || env.TASKHUB_BRIDGE_NAME || file.name || os.hostname().replace(/\.local$/, "")),
    runner: String(args.runner || env.TASKHUB_RUNNER || file.runner || "claude"),     // claude | command
    command: Array.isArray(file.command) ? file.command : null,                        // własny silnik, np. Codex: ["codex","exec","--full-auto","{prompt}"]
    claude: String(args.claude || env.CLAUDE_BIN || file.claude || ""),
    permission: permissionMode(args.permission || env.TASKHUB_PERMISSION || file.permission),
    model: String(args.model || env.TASKHUB_MODEL || file.model || ""),
    pollMs: Number(args.poll || env.TASKHUB_POLL_MS || file.pollMs) || 0,              // 0 = tyle, ile mówi serwer
    mock: args.mock === true || env.TASKHUB_MOCK === "1",
  };
  return cfg;
}
function readConfigFile() { try { return JSON.parse(fs.readFileSync(CONFIG, "utf8")); } catch { return {}; } }
function saveConfig(cfg) {
  fs.mkdirSync(DIR, { recursive: true, mode: 0o700 }); fs.mkdirSync(WORK, { recursive: true });
  const { mock, ...keep } = cfg; void mock;
  fs.writeFileSync(CONFIG, JSON.stringify(keep, null, 2) + "\n", { mode: 0o600 });
}
export function findClaude(cfg) {
  if (cfg.claude) return cfg.claude;
  return [path.join(HOME, ".local", "bin", "claude"), "/opt/homebrew/bin/claude", "/usr/local/bin/claude"].find((p) => fs.existsSync(p)) || "claude";
}
// tryb bez pytań z listą dozwolonych narzędzi; bypassPermissions (i inne tryby, które przepuszczają wszystko) nie wchodzi w grę, także ze starego config.json
const MODES = new Set(["dontAsk", "default", "plan"]);
export const permissionMode = (p) => (MODES.has(String(p || "")) ? String(p) : "dontAsk");
// dozwolone: Task Hub (token biegu) i czytanie w sieci; czytanie plików tylko w katalogu roboczym (domyślnie w dontAsk);
// terminal i zapis plików zablokowane, konektory innych aplikacji nieładowane (--strict-mcp-config), więc nic nie wychodzi na zewnątrz
export const ALLOWED_TOOLS = ["mcp__task-hub", "TodoWrite", "ToolSearch", "WebSearch", "WebFetch"];
export const DISALLOWED_TOOLS = ["Bash", "Monitor", "PowerShell", "Edit", "Write", "NotebookEdit"];
// dopisek do promptu: ten mostek nie ma folderów z kodem ani konektorów innych aplikacji
export const SCRIPT_NOTE = "\n\nTen komputer uruchamia mostek bez aplikacji (skrypt): w tym biegu nie ma folderów z kodem ani konektorów aplikacji zewnętrznych. Kroki z kodem i kroki, które wymagają takich konektorów, oddaj przez leave_step z powodem „Zrobi to aplikacja Task Hub na Macu”.";
// konfiguracja MCP biegu w pliku 0600 (katalog 0700, poza katalogiem roboczym): token nie trafia do argumentów procesu
export function writeMcpConfig(dir, id, mcp, token) {
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  try { fs.chmodSync(dir, 0o700); } catch {}
  const file = path.join(dir, `${String(id).replace(/[^A-Za-z0-9_-]/g, "").slice(0, 60) || "bieg"}-mcp.json`);
  fs.rmSync(file, { force: true });
  fs.writeFileSync(file, JSON.stringify({ mcpServers: { "task-hub": { type: "http", url: mcp, headers: { Authorization: `Bearer ${token}` } } } }), { mode: 0o600, flag: "wx" });
  return file;
}
// argumenty jednego biegu Claude Code: konektor Task Hub z pliku (bez `claude mcp add`), bez pytań o zgodę (nikt nie siedzi przy klawiaturze), tylko narzędzia z listy
export function claudeArgs(prompt, cfg, mcpFile) {
  const a = ["-p", prompt, "--output-format", "stream-json", "--verbose", "--permission-mode", permissionMode(cfg.permission),
    "--mcp-config", mcpFile, "--strict-mcp-config", "--allowedTools", ALLOWED_TOOLS.join(","), "--disallowedTools", DISALLOWED_TOOLS.join(",")];
  if (cfg.model) a.push("--model", cfg.model);
  return a;
}
// własny silnik dostaje {prompt}, {mcp} i {mcpConfig} (plik 0600); token tylko w zmiennej środowiska TASKHUB_MCP_TOKEN, nigdy w argumentach
export function runnerCommand(cfg, prompt, mcp, mcpFile = "") {
  if (cfg.runner === "claude") return { bin: findClaude(cfg), args: claudeArgs(prompt, cfg, mcpFile), json: true };
  if (cfg.command?.length) {
    if (cfg.command.some((s) => String(s).includes("{token}"))) throw new Error("token nie idzie w argumentach komendy: użyj {mcpConfig} (plik z konfiguracją MCP) albo zmiennej środowiska TASKHUB_MCP_TOKEN");
    const sub = (s) => String(s).replaceAll("{prompt}", prompt).replaceAll("{mcp}", mcp).replaceAll("{mcpConfig}", mcpFile);
    return { bin: sub(cfg.command[0]), args: cfg.command.slice(1).map(sub), json: false };
  }
  throw new Error(`nieznany silnik „${cfg.runner}”: claude albo własna komenda w config.json ("runner": "command", "command": [...])`);
}
// usługa launchd: node woła skrypt bezpośrednio, token zostaje w config.json (0600), ANTHROPIC_API_KEY celowo nieustawione (subskrypcja)
export function plistFor({ node, script, log, dir }) {
  const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;");
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>${LABEL}</string>
  <key>ProgramArguments</key><array><string>${esc(node)}</string><string>${esc(script)}</string></array>
  <key>EnvironmentVariables</key><dict>
    <key>PATH</key><string>${esc(path.join(HOME, ".local", "bin"))}:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin</string>
    <key>HOME</key><string>${esc(HOME)}</string>
    <key>TASKHUB_BRIDGE_DIR</key><string>${esc(dir)}</string>
  </dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>ThrottleInterval</key><integer>10</integer>
  <key>ProcessType</key><string>Background</string>
  <key>StandardOutPath</key><string>${esc(log)}</string>
  <key>StandardErrorPath</key><string>${esc(log)}</string>
</dict></plist>
`;
}

// ---------- praca ----------
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const state = { status: "idle", until: null };   // idle | running | limit | auth | error; until = kiedy znów próbować

async function api(cfg, method, p, body) {
  const r = await fetch(cfg.url + p, { method, headers: { Authorization: `Bearer ${cfg.token}`, "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
  const data = await r.json().catch(() => ({}));
  if (r.status === 401) throw Object.assign(new Error(`Task Hub odrzucił token mostka (${data.error || "401"})`), { auth: true });
  return { status: r.status, data };
}
async function poll(cfg) {
  const q = new URLSearchParams({ host: cfg.name, runner: cfg.runner, state: state.status, v: VERSION });
  if (state.until) q.set("until", new Date(state.until).toISOString());
  const { status, data } = await api(cfg, "GET", `/api/bridge/work?${q}`);
  if (status !== 200) throw new Error(`work → HTTP ${status} ${data.error || ""}`);
  return data;
}
// etykieta użycia narzędzia dla podglądu postępu w Task Hub
function labelTool(b) {
  const name = String(b.name || "narzędzie").replace(/^mcp__[^_]+?__/, "").replace(/^mcp__/, "");
  const inp = b.input || {};
  const hint = inp.title || inp.query || inp.summary || inp.stepId || inp.taskId || inp.command || "";
  return hint ? `${name}: ${String(hint).slice(0, 60)}` : name;
}
// jeden proces silnika: stream-json z claude (wynik w zdarzeniu result), zwykły tekst z własnej komendy
export function runProcess(bin, args, { cwd, onStep, maxMs, json, env: extra = {} }) {
  return new Promise((resolve) => {
    const env = { ...process.env, ...extra };
    delete env.ANTHROPIC_API_KEY;                      // subskrypcja, nie faktura za tokeny
    env.PATH = [path.join(HOME, ".local", "bin"), "/opt/homebrew/bin", "/usr/local/bin", env.PATH || "/usr/bin:/bin"].join(":");
    let child;
    try { child = spawn(bin, args, { cwd, env }); } catch (e) { return resolve({ ok: false, error: e.message }); }
    let buf = "", err = "", out = "", final = null, lastData = Date.now(), done = false;
    const finish = (r) => { if (done) return; done = true; clearInterval(watch); clearTimeout(maxT); resolve(r); };
    const watch = setInterval(() => { if (Date.now() - lastData > STALL_MS) { try { child.kill("SIGKILL"); } catch {} finish({ ok: false, error: `claude nie dał znaku życia przez ${Math.round(STALL_MS / 60000)} min, proces ubity` }); } }, 15_000);
    const maxT = setTimeout(() => { try { child.kill("SIGKILL"); } catch {} finish({ ok: false, error: `bieg przekroczył ${Math.round(maxMs / 60000)} min, proces ubity` }); }, maxMs);
    child.on("error", (e) => finish({ ok: false, error: e.code === "ENOENT" ? `nie znaleziono „${bin}”: zainstaluj Claude Code i zaloguj się (claude → /login) albo wskaż ścieżkę (--claude)` : e.message }));
    child.stdout.on("data", (d) => {
      lastData = Date.now(); out += d;
      if (!json) return;
      buf += d; let nl;
      while ((nl = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, nl).trim(); buf = buf.slice(nl + 1);
        if (!line) continue;
        let ev; try { ev = JSON.parse(line); } catch { continue; }
        if (ev.type === "assistant" && Array.isArray(ev.message?.content)) {
          for (const b of ev.message.content) if (b?.type === "tool_use") { try { onStep(labelTool(b)); } catch {} }
        } else if (ev.type === "result") final = ev;
      }
    });
    child.stderr.on("data", (d) => { lastData = Date.now(); err += d; });
    child.on("close", (code) => {
      if (json && final) {
        const bad = final.is_error || (final.subtype && final.subtype !== "success");
        const detail = (typeof final.result === "string" && final.result) || (Array.isArray(final.errors) && final.errors.filter(Boolean).join("; ")) || "";
        return finish(bad ? { ok: false, error: detail || `claude: ${final.subtype || "error"}` } : { ok: true, reply: detail });
      }
      if (code !== 0) return finish({ ok: false, error: `${path.basename(bin)} zakończył się kodem ${code}: ${(err || out).slice(-400) || "(bez komunikatu)"}` });
      finish(json ? { ok: false, error: `brak wyniku z claude: ${(err || out).slice(-400)}` } : { ok: true, reply: out.trim().slice(-600) });
    });
  });
}
export async function runOnce(cfg) {
  // bieg pracy (v2): serwer daje prompt bez wysyłek i krótki token biegu; wysyłki robi aplikacja na Macu osobnym biegiem
  const { status, data } = await api(cfg, "POST", "/api/bridge/run", { bridge: cfg.name, v: Number(VERSION), kind: "work" });
  if (status === 409) { log(`bieg zajęty (${data.run?.bridge ?? "inny mostek"}), czekam`); return "busy"; }
  if (status !== 200) throw new Error(`run → HTTP ${status} ${data.error || ""}`);
  const id = data.run.id;
  state.status = "running";
  log(`▶ bieg ${id.slice(0, 8)}`);
  const touch = (note) => api(cfg, "PATCH", `/api/bridge/run/${id}`, note === undefined ? {} : { note }).catch(() => {});
  const keep = setInterval(() => touch(), 30_000);
  let res, mcpFile = "";
  try {
    if (cfg.mock) { await touch("(próba) udaję pracę"); await sleep(1500); res = { ok: true, reply: "(próba) mostek działa, Claude nie był uruchamiany" }; }
    else {
      const token = data.token || cfg.token;   // starszy serwer nie daje tokenu biegu: wtedy token mostka, jak dawniej
      mcpFile = writeMcpConfig(RUN_DIR, id, data.mcp, token);
      const { bin, args, json } = runnerCommand(cfg, String(data.prompt) + SCRIPT_NOTE, data.mcp, mcpFile);
      const env = cfg.runner === "claude" ? {} : { TASKHUB_MCP_URL: data.mcp, TASKHUB_MCP_TOKEN: token, TASKHUB_MCP_CONFIG: mcpFile };
      res = await runProcess(bin, args, { cwd: WORK, onStep: (s) => { log("  ·", s); touch(s); }, maxMs: (data.maxMinutes || 45) * 60_000, json, env });
    }
  } catch (e) { res = { ok: false, error: e.message }; }
  finally { clearInterval(keep); if (mcpFile) { try { fs.rmSync(mcpFile, { force: true }); } catch {} } }
  let outcome = "done", note = String(res.reply || "").slice(0, 600);
  if (!res.ok) {
    note = String(res.error || "").slice(0, 600);
    const lim = parseLimit(res.error);
    if (lim.limit) { outcome = "limit"; state.status = "limit"; state.until = lim.reset_at || Date.now() + 30 * 60_000; }
    else if (parseAuth(res.error)) { outcome = "auth"; state.status = "auth"; state.until = Date.now() + 5 * 60_000; }
    else { outcome = "error"; state.status = "error"; state.until = Date.now() + 60_000; }
  } else { state.status = "idle"; state.until = null; }
  await api(cfg, "PATCH", `/api/bridge/run/${id}`, { outcome, note }).catch((e) => log("koniec biegu nie zgłoszony:", e.message));
  log(`${res.ok ? "✓" : "✗"} bieg ${id.slice(0, 8)} (${outcome}): ${note.slice(0, 160)}`);
  return outcome;
}
export async function loop(cfg, { once = false } = {}) {
  let lastErr = "", lastSends = 0;
  for (;;) {
    let wait = cfg.pollMs || 15_000;
    try {
      if (state.until && Date.now() >= state.until) { state.until = null; state.status = "idle"; }
      const w = await poll(cfg);
      if (!cfg.pollMs && w.pollMs) wait = w.pollMs;
      lastErr = "";
      // v2: tylko praca (work); szkice do wysłania (sends) czekają na aplikację na Macu, ten skrypt ich nie wysyła
      const todo = typeof w.work === "number" ? w.work : w.pending;
      if (w.sends !== lastSends && w.sends > 0) log(`zatwierdzone szkice do wysłania: ${w.sends} (wyśle je aplikacja Task Hub na Macu)`);
      lastSends = w.sends || 0;
      if (todo > 0 && !w.run && !state.until) {
        const o = await runOnce(cfg);
        if (o === "done" && !once) continue;        // od razu sprawdź, czy coś jeszcze czeka
      }
    } catch (e) {
      const msg = e.auth ? `${e.message}. Utwórz nowy token mostka w Ustawieniach Task Hub.` : `błąd połączenia z Task Hub: ${e.message}`;
      if (msg !== lastErr) log(msg); lastErr = msg;
      wait = e.auth ? 60_000 : 30_000;
    }
    if (once) return;
    await sleep(wait);
  }
}

// ---------- jedna instancja ----------
function claimLock() {
  fs.mkdirSync(DIR, { recursive: true, mode: 0o700 });
  try {
    const held = Number(fs.readFileSync(LOCK, "utf8").trim());
    if (held && held !== process.pid) { try { process.kill(held, 0); log(`mostek już działa (PID ${held}), kończę`); process.exit(0); } catch (e) { if (e.code === "EPERM") { log(`mostek już działa (PID ${held}), kończę`); process.exit(0); } } }
  } catch { /* brak locka */ }
  fs.writeFileSync(LOCK, String(process.pid));
  const release = () => { try { if (Number(fs.readFileSync(LOCK, "utf8").trim()) === process.pid) fs.rmSync(LOCK); } catch {} };
  process.on("exit", release);
  for (const sig of ["SIGINT", "SIGTERM", "SIGHUP"]) process.on(sig, () => { release(); process.exit(0); });
}

// ---------- polecenia ----------
function launchctl(...a) { return spawnSync("launchctl", a, { encoding: "utf8" }); }
async function install(cfg, script) {
  if (!cfg.url || !cfg.token) throw new Error("podaj --url i token mostka z Ustawień Task Hub (zmienna TASKHUB_BRIDGE_TOKEN albo --token)");
  const w = await poll(cfg);
  log(`połączono z ${cfg.url}: czeka ${w.pending} ${w.pending === 1 ? "rzecz" : "rzeczy"}`);
  const bin = findClaude(cfg);
  const v = spawnSync(bin, ["--version"], { encoding: "utf8" });
  if (v.error) log(`UWAGA: nie znalazłem Claude Code (${bin}). Zainstaluj go i zaloguj się: claude → /login. Mostek będzie czekał.`);
  else log(`Claude Code: ${(v.stdout || v.stderr).trim()} (${bin})`);
  saveConfig({ ...cfg, claude: v.error ? cfg.claude : bin });
  if (process.platform !== "darwin") { log(`konfiguracja zapisana w ${CONFIG}. To nie macOS: uruchom „node ${script}” w tle (np. systemd, tmux).`); return; }
  fs.mkdirSync(path.dirname(PLIST), { recursive: true });
  fs.writeFileSync(PLIST, plistFor({ node: process.execPath, script: path.resolve(script), log: LOG, dir: DIR }));
  const uid = String(os.userInfo().uid);
  launchctl("bootout", `gui/${uid}/${LABEL}`);
  const r = launchctl("bootstrap", `gui/${uid}`, PLIST);
  if (r.status !== 0) throw new Error(`launchctl bootstrap: ${(r.stderr || r.stdout).trim()}`);
  log(`mostek zainstalowany i uruchomiony (startuje po zalogowaniu). Stan: node ${script} --status · log: ${LOG}`);
}
function uninstall() {
  if (process.platform === "darwin") { launchctl("bootout", `gui/${os.userInfo().uid}/${LABEL}`); try { fs.rmSync(PLIST); } catch {} }
  log(`usługa wyłączona. Konfiguracja została w ${CONFIG} (usuń ręcznie, jeśli nie chcesz jej trzymać).`);
}
function status(cfg) {
  console.log(`Task Hub: ${cfg.url || "(brak adresu)"} · komputer: ${cfg.name} · silnik: ${cfg.runner}${cfg.runner === "claude" ? ` (${findClaude(cfg)})` : ""} · token: ${cfg.token ? "jest" : "BRAK"}`);
  if (process.platform === "darwin") { const r = launchctl("list"); const line = (r.stdout || "").split("\n").find((l) => l.includes(LABEL)); console.log(line ? `usługa: ${line.trim()} (PID, ostatni kod wyjścia, nazwa)` : "usługa: nie zainstalowana"); }
  try { const lines = fs.readFileSync(LOG, "utf8").trim().split("\n"); console.log(`--- ostatnie wpisy (${LOG}):`); console.log(lines.slice(-15).join("\n")); } catch { console.log("log: jeszcze pusty"); }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const script = process.argv[1];
  if (args.help) {
    console.log(`Mostek Task Hub (v${VERSION})\n  --install --url URL                 zainstaluj jako usługę (macOS) i uruchom (token w TASKHUB_BRIDGE_TOKEN)\n  --uninstall                         wyłącz usługę\n  --status                            stan usługi i log\n  --once                              jeden przebieg (test)\n  --mock                              bez Claude (sprawdzenie połączenia)\n  bez argumentów                      praca w tym oknie\nopcje: --name NAZWA --claude ŚCIEŻKA --runner claude|command --permission dontAsk|default|plan --model MODEL --poll MS`);
    return;
  }
  const cfg = loadConfig(args);
  if (args.install) return install(cfg, script);
  if (args.uninstall) return uninstall();
  if (args.status) return status(cfg);
  if (!cfg.url || !cfg.token) throw new Error("brak adresu albo tokenu: uruchom z --install --url … --token … (token mostka z Ustawień Task Hub)");
  fs.mkdirSync(WORK, { recursive: true });
  claimLock();
  try { for (const f of fs.readdirSync(RUN_DIR)) fs.rmSync(path.join(RUN_DIR, f), { force: true }); } catch {}   // pliki biegów sprzed awarii
  log(`mostek Task Hub v${VERSION} → ${cfg.url} · komputer: ${cfg.name} · silnik: ${cfg.runner}${cfg.mock ? " (próba, bez Claude)" : ""}`);
  await loop(cfg, { once: args.once === true });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => { console.error("błąd:", e.message); process.exit(1); });
}
