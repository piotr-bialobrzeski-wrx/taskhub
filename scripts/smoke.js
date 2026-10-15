// Uruchomienie: npm run build && npm start (z .env.local), potem: node scripts/smoke.js (wymaga pakietu playwright i hasła haslo123 w TASKHUB_PASSWORD)
// Przeklikanie aplikacji: logowanie, zadanie z czatu (bez AI), kroki, zasady, token MCP, serwer MCP.
const { chromium } = require("playwright");
const BASE = "http://localhost:3000";
const out = (m) => console.log("•", m);
(async () => {
  const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" }).catch(() => chromium.launch());
  const page = await browser.newPage({ viewport: { width: 1100, height: 900 } });
  const errors = []; page.on("pageerror", (e) => errors.push(String(e))); page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });

  await page.goto(BASE + "/");
  if (!page.url().includes("/login")) throw new Error("brak przekierowania do logowania");
  await page.fill('input[name=password]', "zle"); await page.click("button[type=submit]"); await page.waitForURL(/e=1/);
  out("złe hasło odrzucone");
  await page.fill('input[name=password]', "haslo123"); await page.click("button[type=submit]"); await page.waitForURL(BASE + "/");
  out("zalogowano, kanwa");

  await page.fill(".chat input[name=text]", "Ania pyta o catering na czwartek dla 12 osób");
  await page.click(".chat button[type=submit]");
  await page.waitForURL(/\/tasks\//, { timeout: 20000 });
  const taskUrl = page.url();
  out("bez klucza modelu czat założył zadanie: " + taskUrl);
  if (!(await page.textContent("h1")).includes("catering")) throw new Error("tytuł zadania");

  // krok ręcznie
  await page.click("summary:has-text('Dodaj krok ręcznie')");
  const add = page.locator("form").filter({ has: page.locator("input[name=title]") }).last();
  await add.locator("input[name=title]").fill("Sprawdzić budżet");
  await add.locator("select[name=tool]").selectOption("clickup");
  await add.locator("input[name=link]").fill("https://app.clickup.com/t/abc");
  await add.locator("button[type=submit]").click();
  await page.waitForSelector(".step:has-text('Sprawdzić budżet')");
  out("krok dodany");
  const step = page.locator(".step").filter({ hasText: "Sprawdzić budżet" });
  if (!(await step.locator("a:has-text('Otwórz w ClickUp')").count())) throw new Error("brak przycisku Otwórz w X");
  await step.locator("button:has-text('Gotowe')").click();
  await page.waitForSelector(".step.done:has-text('Sprawdzić budżet')");
  out("krok gotowy, obrys zielony");
  if (!(await page.textContent("body")).includes("ukończone")) throw new Error("zadanie powinno być ukończone");
  await step.locator("button:has-text('Otwórz ponownie')").click();
  await page.waitForSelector(".step.todo:has-text('Sprawdzić budżet')");
  out("krok otwarty ponownie");

  // hand-off
  await step.locator("button:has-text('Zrób w Claude')").click();
  await page.waitForSelector(".step.handoff");
  const href = await step.locator("a:has-text('Otwórz w Claude')").getAttribute("href");
  if (!href.startsWith("https://claude.ai/new?q=")) throw new Error("link do Claude");
  if (!decodeURIComponent(href).includes("complete_step")) throw new Error("prompt bez complete_step");
  await step.locator("textarea[name=report]").fill("Zrobione, budżet 1200 zł, szczegóły: https://app.clickup.com/t/abc");
  await step.locator("button:has-text('Odbierz')").click();
  await page.waitForSelector(".step.done:has-text('Sprawdzić budżet')");
  out("hand-off i odbiór raportu działają");
  await page.screenshot({ path: "s-task.png", fullPage: true });

  // edycja zadania: priorytet, termin
  await page.click("summary:has-text('Edytuj zadanie')");
  await page.selectOption("select[name=level]", "5");
  await page.fill("input[name=due]", new Date().toISOString().slice(0, 10));
  await page.locator("form").filter({ has: page.locator("input[name=id]") }).first().locator("button:has-text('Zapisz')").click();
  await page.waitForTimeout(800);
  await page.goto(BASE + "/");
  const row = page.locator(".task-row").filter({ hasText: "catering" }).first();
  if (!(await row.textContent()).includes("termin")) throw new Error("brak terminu na kanwie");
  out("kanwa pokazuje termin i priorytet");
  await page.screenshot({ path: "s-board.png", fullPage: true });

  // zasady
  await page.goto(BASE + "/rules");
  const rf = page.locator("form").last();
  await rf.locator("select[name=scope]").selectOption("tool"); await rf.locator("select[name=tool]").selectOption("slack");
  await rf.locator("input[name=title]").fill("Slack krótko"); await rf.locator("textarea[name=body]").fill("Krótko, bez emoji.");
  await rf.locator("button[type=submit]").click();
  await page.waitForSelector(".rule:has-text('Slack krótko')");
  out("zasada zapisana");

  // ustawienia: projekt i token
  await page.goto(BASE + "/settings");
  const pf = page.locator("form").filter({ has: page.locator("input[placeholder='Nowy projekt']") });
  await pf.locator("input[name=name]").fill("Warsztaty"); await pf.locator("select[name=weight]").selectOption("5");
  await pf.locator("button:has-text('Dodaj')").click();
  await page.waitForSelector("input[value='Warsztaty']");
  out("projekt dodany");
  await page.fill("input[name=name][placeholder*='Nazwa klienta']", "Claude Code test");
  await page.click("button:has-text('Nowy token')");
  await page.waitForSelector("code");
  const token = (await page.textContent("code")).trim();
  if (!token.startsWith("th_")) throw new Error("token");
  out("token utworzony");
  await page.screenshot({ path: "s-settings.png", fullPage: true });

  // MCP przez HTTP
  const rpc = async (body, sid) => {
    const r = await fetch(BASE + "/api/mcp", { method: "POST", headers: { "content-type": "application/json", accept: "application/json, text/event-stream", authorization: "Bearer " + token, ...(sid ? { "mcp-session-id": sid } : {}) }, body: JSON.stringify(body) });
    const txt = await r.text();
    const data = txt.startsWith("event:") || txt.startsWith("data:") ? JSON.parse(txt.split("\n").find((l) => l.startsWith("data:")).slice(5)) : JSON.parse(txt);
    return { status: r.status, sid: r.headers.get("mcp-session-id"), data };
  };
  const bad = await fetch(BASE + "/api/mcp", { method: "POST", headers: { "content-type": "application/json", accept: "application/json, text/event-stream", authorization: "Bearer th_zly" }, body: "{}" });
  if (bad.status !== 401) throw new Error("zły token powinien dać 401, jest " + bad.status);
  const init = await rpc({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "smoke", version: "1" } } });
  out("MCP initialize: " + init.status + " " + (init.data.result?.serverInfo?.name ?? JSON.stringify(init.data).slice(0, 120)));
  const tools = await rpc({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} }, init.sid);
  out("MCP tools: " + (tools.data.result?.tools ?? []).map((t) => t.name).join(", "));
  const list = await rpc({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "list_tasks", arguments: { includeDone: true } } }, init.sid);
  const text = list.data.result?.content?.[0]?.text ?? JSON.stringify(list.data);
  if (!text.includes("catering")) throw new Error("list_tasks nie zwraca zadania: " + text.slice(0, 200));
  out("MCP list_tasks zwraca zadanie z priorytetem: " + text.split("\n")[0].slice(0, 120));
  const created = await rpc({ jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "create_task", arguments: { title: "Zadanie z MCP", level: 2, steps: [{ title: "Krok z MCP", tool: "slack" }] } } }, init.sid);
  out("MCP create_task: " + (created.data.result?.content?.[0]?.text ?? JSON.stringify(created.data)).slice(0, 120));

  await page.goto(BASE + "/");
  if (!(await page.textContent("body")).includes("Zadanie z MCP")) throw new Error("zadanie z MCP nie widać na kanwie");
  out("zadanie z MCP widoczne na kanwie");
  if (errors.length) out("BŁĘDY KONSOLI: " + errors.join(" | "));
  await browser.close();
  console.log("SMOKE OK");
})().catch((e) => { console.error("SMOKE FAIL", e); process.exit(1); });
