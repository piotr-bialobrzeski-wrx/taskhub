# Mostek Task Hub

Wzorzec z Project Hub: aplikacja w chmurze nie ma jak sama uruchomić Claude na Twoim komputerze, więc robi to **mostek**: program, który co kilkanaście sekund pyta Task Hub „czy czeka praca?” zwykłym HTTP (zero tokenów) i dopiero wtedy uruchamia w tle Claude Code (`claude -p`) na Twojej subskrypcji, z konektorem Task Hub podanym wprost i Twoimi konektorami z Claude Code. Wynik wraca do Task Hub przez konektor (add_steps, add_facts, set_blocks, complete_step). Gdy komputer śpi, pracę przejmuje zapas: zadanie zaplanowane na koncie Claude co godzinę, które samo ustępuje, gdy mostek żyje (`list_work` odpowiada mu „MOSTEK AKTYWNY”).

Dwie postacie tego samego mechanizmu:

- **Aplikacja Task Hub na Maca** (`macos/`): instalator .pkg, mostek w środku, stan w pasku menu, okno z aplikacją, szybkie dodawanie zadania. To główna droga.
- **Skrypt** (`public/bridge/taskhub-bridge.mjs`, serwowany pod `/bridge/taskhub-bridge.mjs`): ta sama logika bez aplikacji, dla serwera, Linuxa, testów i jako zapas. Node 20+, bez zależności.

## Jak to działa po stronie serwera

| Co | Gdzie |
|---|---|
| Token mostka (rodzaj `bridge`, puls `seen_at`, `meta` z komputerem i stanem) | `api_tokens`, Ustawienia → Agent → Mostek |
| „Czy czeka praca?” + puls | `GET /api/bridge/work?host=&runner=&state=&until=&v=` → `{ pending, counts, run, pollMs }` |
| Początek biegu (jeden otwarty na właściciela, unikalny indeks częściowy) | `POST /api/bridge/run` → `{ run, prompt, mcp, maxMinutes }` albo 409 `{ busy }` |
| Postęp i koniec | `PATCH /api/bridge/run/:id` `{ note }` albo `{ outcome: done|error|limit|auth, note }` |
| Bieg bez sygnału 15 min | wygasa (`stale`) i zwalnia miejsce |
| Automat co godzinę i inni agenci | `list_work` bez `force` odpowiada „MOSTEK AKTYWNY”, gdy puls jest młodszy niż 2 min |

Prompt biegu podaje serwer (`src/lib/bridge.ts`), więc zmiany promptu wdrażają się razem z aplikacją, bez ruszania komputera.

## Skrypt: użycie

```sh
curl -fsSL https://TWOJA-APLIKACJA/bridge/taskhub-bridge.mjs -o ~/taskhub-bridge.mjs
node ~/taskhub-bridge.mjs --install --url https://TWOJA-APLIKACJA --token th_…   # macOS: usługa launchd, start po zalogowaniu
node ~/taskhub-bridge.mjs --status      # stan usługi i ostatnie wpisy logu (~/Library/Logs/taskhub-bridge.log)
node ~/taskhub-bridge.mjs --uninstall   # wyłącza usługę
node ~/taskhub-bridge.mjs --once        # jeden przebieg w tym oknie
node ~/taskhub-bridge.mjs --mock        # bez Claude: sprawdza połączenie i bieg
```

Konfiguracja w `~/.taskhub-bridge/config.json` (uprawnienia 0600): `url`, `token`, `name`, `claude` (ścieżka), `permission` (domyślnie `bypassPermissions`, bo nikt nie siedzi przy klawiaturze), `model`, `pollMs` (0 = tyle, ile mówi serwer: 15 s w dzień, 60 s w nocy). Zmienne środowiska `TASKHUB_URL`, `TASKHUB_BRIDGE_TOKEN`, `TASKHUB_BRIDGE_NAME`, `CLAUDE_BIN`, `TASKHUB_PERMISSION`, `TASKHUB_MODEL`, `TASKHUB_POLL_MS` mają pierwszeństwo przed plikiem, argumenty przed zmiennymi.

`ANTHROPIC_API_KEY` jest celowo usuwane ze środowiska Claude Code: praca idzie na subskrypcji, nie na fakturę za tokeny. Limit subskrypcji: bieg kończy się jako `limit`, mostek czeka do końca okna (rozpoznawanie w `parseLimit`). Wylogowany Claude Code: `auth`, mostek czeka i co 5 min próbuje znowu; zaloguj się w Terminalu (`claude`, `/login`). Brak sygnału z Claude przez 10 min: proces ubity, bieg `error`.

## Inny silnik (Codex na subskrypcji ChatGPT)

W `config.json` ustaw `"runner": "command"` i własną komendę z podstawieniami `{prompt}`, `{mcp}`, `{token}`, np.

```json
{ "runner": "command", "command": ["codex", "exec", "--full-auto", "{prompt}"] }
```

Konektor Task Hub trzeba wtedy dodać w konfiguracji Codexa (serwer MCP po HTTP z nagłówkiem `Authorization: Bearer {token}`); sprawdź składnię w dokumentacji Codex CLI dla swojej wersji. Wynik takiej komendy mostek traktuje jako tekst (ostatnie 600 znaków trafia do notatki biegu).

## Bezpieczeństwo

- Mostek łączy się tylko wychodząco po HTTPS; nic nie nasłuchuje na komputerze.
- Token mostka działa wyłącznie na `/api/bridge/*` i konektorze MCP; można go unieważnić w Ustawieniach (Połączenia).
- Claude Code dostaje tryb bez pytań o zgodę na narzędzia, ale prompt biegu zabrania wysyłać cokolwiek na zewnątrz bez zatwierdzonego szkicu, usuwać i zmieniać plików poza katalogiem roboczym (`~/.taskhub-bridge/work`, poza Dokumentami, żeby macOS nie blokował dostępu, lekcja z Project Hub).
