# Mostek Task Hub

Wzorzec z Project Hub: aplikacja w chmurze nie ma jak sama uruchomić Claude na Twoim komputerze, więc robi to **mostek**: program, który co kilkanaście sekund pyta Task Hub „czy czeka praca?” zwykłym HTTP (zero tokenów) i dopiero wtedy uruchamia w tle Claude Code (`claude -p`) na Twojej subskrypcji, z konektorem Task Hub podanym wprost i Twoimi konektorami z Claude Code. Wynik wraca do Task Hub przez konektor (add_steps, add_facts, set_blocks, complete_step). Gdy komputer śpi, pracę przejmuje zapas: zadanie zaplanowane na koncie Claude co godzinę, które samo ustępuje, gdy mostek żyje (`list_work` odpowiada mu „MOSTEK AKTYWNY”).

Dwie postacie tego samego mechanizmu:

- **Aplikacja Task Hub na Maca** (`macos/`): instalator .pkg, mostek w środku, stan w pasku menu, okno z aplikacją, szybkie dodawanie zadania. To główna droga.
- **Skrypt** (`public/bridge/taskhub-bridge.mjs`, serwowany pod `/bridge/taskhub-bridge.mjs`): ta sama logika bez aplikacji, dla serwera, Linuxa, testów i jako zapas. Node 20+, bez zależności.

## Jak to działa po stronie serwera

| Co | Gdzie |
|---|---|
| Token mostka (rodzaj `bridge`, puls `seen_at`, `meta` z komputerem i stanem) | `api_tokens`, Ustawienia → Agent → Mostek |
| „Czy czeka praca?” + puls | `GET /api/bridge/work?host=&runner=&state=&until=&v=` → `{ pending, counts, run, pollMs }`; v=2 dodaje `work` (praca bez wysyłek) i `sends` (zatwierdzone szkice do wysłania), `pending = work + sends` |
| Początek biegu (jeden otwarty na właściciela, unikalny indeks częściowy) | `POST /api/bridge/run` → `{ run, prompt, mcp, maxMinutes }` albo 409 `{ busy }` (v1, bez `v`) |
| Bieg pracy (v2) | `POST /api/bridge/run { bridge, v: 2, kind: "work" }` → `{ run, kind, prompt, mcp, token, maxMinutes, staleMinutes }`; `token` to krótki token biegu (bez wysyłek, gaśnie z końcem biegu) dla Claude Code zamiast tokenu mostka |
| Bieg wysyłki (v2) | `POST /api/bridge/run { bridge, v: 2, kind: "send" }` → najdawniej zatwierdzony szkic (kroki przed nim zrobione), najwyżej raz: `{ run, kind, step, target, maxMinutes: 10, git: { repo, branch, message, files, push } }` (commit robi aplikacja na Macu, bez modelu) albo `{ …, prompt, mcp, token, servers }` (Claude Code wysyła tylko konektorem z `servers`); 204 = nic do wysłania; 422 = brak konektora na tym komputerze albo bloku zmian (zgoda wraca do Piotra z notatką w zadaniu) |
| Postęp i koniec | `PATCH /api/bridge/run/:id` `{ note }` albo `{ outcome: done|error|limit|auth|stopped, note, sent?: { summary, link } }`; `sent` przy `done` zamyka krok biegu wysyłki (commit z aplikacji); koniec biegu gasi jego tokeny, a bieg wysyłki bez zrobionego kroku cofa zgodę z notatką „Wysyłka nie została potwierdzona…” (bez ponawiania) |
| Bieg bez sygnału 15 min | wygasa (`stale`) i zwalnia miejsce (dla biegu wysyłki jak wyżej: zgoda wraca do Piotra) |
| Automat co godzinę i inni agenci | `list_work` bez `force` odpowiada „MOSTEK AKTYWNY”, gdy puls jest młodszy niż 2 min; konektor i automat nigdy nie dostają zatwierdzonych szkiców do wysłania |
| Aktualizacja aplikacji na Maca | `GET /api/bridge/app` (token mostka) → `{ version, notes, zip: { url, sha256 }, pkg: { url, sha256 } }`; `GET /api/bridge/app/download?asset=` (token mostka albo sesja) i `GET /api/app/download` (sesja, instalator .pkg z Ustawień) przekierowują na krótko ważny adres GitHuba. Przy prywatnym repozytorium serwer potrzebuje `GITHUB_RELEASES_TOKEN` (fine-grained, contents: read); token nie trafia do odpowiedzi |

Prompty biegów podaje serwer (`src/lib/bridge.ts`: `bridgePrompt` dla v1, `bridgeWorkPrompt` i `sendPrompt` dla v2), więc zmiany promptu wdrażają się razem z aplikacją, bez ruszania komputera. Klient bez `v` albo z `v=1` (aplikacja 0.1.6, stary skrypt) działa jak dotąd: jego bieg wysyła zatwierdzone szkice sam.

## Skrypt: użycie

```sh
curl -fsSL https://TWOJA-APLIKACJA/bridge/taskhub-bridge.mjs -o ~/taskhub-bridge.mjs
TASKHUB_BRIDGE_TOKEN=th_… node ~/taskhub-bridge.mjs --install --url https://TWOJA-APLIKACJA   # macOS: usługa launchd, start po zalogowaniu (token w zmiennej, nie w argumentach)
node ~/taskhub-bridge.mjs --status      # stan usługi i ostatnie wpisy logu (~/Library/Logs/taskhub-bridge.log)
node ~/taskhub-bridge.mjs --uninstall   # wyłącza usługę
node ~/taskhub-bridge.mjs --once        # jeden przebieg w tym oknie
node ~/taskhub-bridge.mjs --mock        # bez Claude: sprawdza połączenie i bieg
```

Konfiguracja w `~/.taskhub-bridge/config.json` (uprawnienia 0600): `url`, `token`, `name`, `claude` (ścieżka), `permission` (`dontAsk`, czyli bez pytań, ale tylko narzędzia z listy; do wyboru jeszcze `default` i `plan`; `bypassPermissions` ze starej konfiguracji zamienia się na `dontAsk`), `model`, `pollMs` (0 = tyle, ile mówi serwer: 15 s w dzień, 60 s w nocy). Zmienne środowiska `TASKHUB_URL`, `TASKHUB_BRIDGE_TOKEN`, `TASKHUB_BRIDGE_NAME`, `CLAUDE_BIN`, `TASKHUB_PERMISSION`, `TASKHUB_MODEL`, `TASKHUB_POLL_MS` mają pierwszeństwo przed plikiem, argumenty przed zmiennymi.

`ANTHROPIC_API_KEY` jest celowo usuwane ze środowiska Claude Code: praca idzie na subskrypcji, nie na fakturę za tokeny. Limit subskrypcji: bieg kończy się jako `limit`, mostek czeka do końca okna (rozpoznawanie w `parseLimit`). Wylogowany Claude Code: `auth`, mostek czeka i co 5 min próbuje znowu; zaloguj się w Terminalu (`claude`, `/login`). Brak sygnału z Claude przez 10 min: proces ubity, bieg `error`.

## Inny silnik (Codex na subskrypcji ChatGPT)

W `config.json` ustaw `"runner": "command"` i własną komendę z podstawieniami `{prompt}`, `{mcp}` (adres konektora) i `{mcpConfig}` (plik 0600 z konfiguracją MCP i tokenem biegu), np.

```json
{ "runner": "command", "command": ["codex", "exec", "--full-auto", "{prompt}"] }
```

Konektor Task Hub trzeba wtedy dodać w konfiguracji Codexa (serwer MCP po HTTP z nagłówkiem `Authorization: Bearer …`); token biegu dostaje komenda w zmiennej środowiska `TASKHUB_MCP_TOKEN` (adres w `TASKHUB_MCP_URL`, plik w `TASKHUB_MCP_CONFIG`), nigdy w argumentach: komenda z `{token}` jest odrzucana. Sprawdź składnię w dokumentacji Codex CLI dla swojej wersji. Wynik takiej komendy mostek traktuje jako tekst (ostatnie 600 znaków trafia do notatki biegu).

## Bezpieczeństwo

- Mostek łączy się tylko wychodząco po HTTPS; nic nie nasłuchuje na komputerze.
- Token mostka działa wyłącznie na `/api/bridge/*` i konektorze MCP; można go unieważnić w Ustawieniach (Połączenia). Claude Code w biegu v2 go nie dostaje: pracuje krótkim tokenem biegu, który gaśnie z końcem biegu, nie działa na `/api/bridge/*` i nie widać go w Ustawieniach.
- Claude Code nie dostaje `bypassPermissions`. Tryb to `dontAsk` z listą dozwolonych narzędzi: w aplikacji na Macu Task Hub, narzędzia konektorów do czytania, pliki i testy tylko w folderach z kodem (Ustawienia aplikacji → Foldery z kodem), z piaskownicą i strażnikiem przed każdym narzędziem; w skrypcie tylko Task Hub i czytanie w sieci (`--allowedTools mcp__task-hub,TodoWrite,ToolSearch,WebSearch,WebFetch`, bez terminala i zapisu plików, `--strict-mcp-config`). Konfiguracja MCP z tokenem leży w pliku 0600 poza katalogiem roboczym (`~/.taskhub-bridge/run`) i znika po biegu; tokenu nie ma w argumentach procesu.
- Zwykły bieg niczego nie wysyła: wiadomość, komentarz czy zmiana u innych to szkic do zatwierdzenia. Zgodę daje tylko kliknięcie Piotra „Zatwierdź” (podpis treści szkicu, każda zmiana go kasuje). Zatwierdzony szkic wysyła osobny bieg wysyłki: jeden szkic, tylko konektor tej aplikacji, najwyżej raz; commit i push robi sama aplikacja na Macu (tylko pliki z bloku zmian, bez `--force`). Skrypt nie robi biegów wysyłki.
- Katalog roboczy `~/.taskhub-bridge/work` (aplikacja: `~/Library/Application Support/Task Hub/work`) leży poza Dokumentami, żeby macOS nie blokował dostępu (lekcja z Project Hub).
