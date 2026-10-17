# Task Hub na Maca

Natywna aplikacja (Swift, AppKit + WebKit + SwiftUI), odpowiednik Claude Code Quick z Project Hub, ale z mostkiem w środku:

- **okno z Task Hub** (aplikacja webowa w WKWebView, logowanie zapamiętane, linki na zewnątrz idą do przeglądarki),
- **ikona w pasku menu** ze stanem mostka (czuwa / Claude pracuje / limit / wylogowany), „Sprawdź teraz”, „Nowe zadanie…”,
- **okienko „Nowe zadanie”** pod ⌃⌥T z każdego miejsca (⌘N w aplikacji): wklej maila albo opis, ⌘↩ wysyła, Claude zaczyna od razu,
- **mostek**: co kilkanaście sekund pyta Task Hub tanim HTTP (`GET /api/bridge/work`, zero tokenów), a gdy czeka praca,
  bierze bieg (`POST /api/bridge/run`) i uruchamia `claude -p … --permission-mode bypassPermissions --mcp-config …` na subskrypcji
  (ANTHROPIC_API_KEY celowo nieustawione), przekazuje użycia narzędzi jako postęp i zgłasza wynik (`PATCH /api/bridge/run/:id`),
- **Ustawienia** (⌘,): adres, token mostka, ścieżka do Claude Code, model, start po zalogowaniu (SMAppService), dziennik,
- **rejestr połączeń**: po starcie i co 6 godzin (albo po „Sprawdź teraz”) wysyła do Task Hub listę serwerów MCP z `claude mcp list`
  (`POST /api/bridge/connections`: nazwy, adresy i stan, nigdy tokeny), więc agent wie, czym dysponuje z tego Maca
- **samoaktualizacja**: co 6 godzin pyta GitHub o najnowsze wydanie, pobiera `.zip` z aplikacją (bez kwarantanny, więc bez Gatekeepera),
  podmienia `/Applications/Task Hub.app` (stara wersja do Kosza) i uruchamia się ponownie, gdy okna są zamknięte i mostek nie pracuje
  (inaczej pyta). Bez prawa zapisu w /Applications otwiera instalator `.pkg`. Wyłączalna w Ustawieniach,
- link `taskhub://connect?url=…&token=…` z Ustawień Task Hub wpisuje adres i token bez przepisywania.

Mostek pracuje także przy zamkniętym oknie (aplikacja zostaje w pasku menu). Gdy Mac śpi, pracę przejmuje automat co godzinę.

## Pliki

- `Sources/` – kod: `App.swift` (start, @main), `AppDelegate.swift` (menu, pasek menu, okna, link taskhub://), `WebWindow.swift` (okno z aplikacją),
  `QuickEntry.swift` (szybkie zadanie), `SettingsView.swift` (ustawienia), `Bridge.swift` (pętla mostka), `ProcessRunner.swift` (bieg Claude Code,
  stream-json, strażnik), `ClaudeCLI.swift` (szukanie Claude Code, środowisko, limit/wylogowanie), `Store.swift` (config.json), `HotKey.swift` (⌃⌥T),
  `Theme.swift` (kolory i pigułki z aplikacji webowej), `Log.swift` (dziennik), `Updater.swift` (samoaktualizacja z wydań GitHub).
- `VERSION` – numer wersji aplikacji (podbicie = nowe wydanie).
- `Info.plist` – tożsamość (`com.taskhub.app`), schemat `taskhub`, macOS 13+.
- `Icon/icon-1024.png` – ikona; `build.sh` robi z niej `AppIcon.icns`.
- `build.sh` – budowa (arm64 + x86_64), podpis ad hoc, `.pkg` (instaluje do /Applications) i `.dmg`.
- `.github/workflows/mac-app.yml` – budowa na GitHub Actions (macos-14) i wydanie na GitHubie.

## Budowa

Na Macu z Xcode Command Line Tools: `macos/build.sh 0.1.0`. Wynik w `macos/build/`.

Na GitHubie: wersja siedzi w `macos/VERSION`. Push do `main` z nową wersją buduje właściwe wydanie `app-v<wersja>` (tag zakłada sam
GitHub Actions, bo push tagów z sesji w chmurze jest zablokowany), na które wskazuje `…/releases/latest` (link „Pobierz aplikację”
w Ustawieniach Task Hub). Kolejne pushe z tą samą wersją odświeżają wydanie wstępne `app-latest`. Nowa wersja dla Piotra = podbij `macos/VERSION`.

## Instalacja u użytkownika

1. Pobierz `.pkg` z wydania i otwórz. Aplikacja nie jest notaryzowana (podpis ad hoc), więc przy pierwszym otwarciu:
   Ustawienia systemowe → Prywatność i ochrona → „Otwórz mimo to”.
2. Zainstaluj Claude Code i zaloguj się raz w Terminalu: `claude`, potem `/login`.
3. W Task Hub (przeglądarka) → Ustawienia → Mostek na komputerze → token → „Połącz aplikację Task Hub na tym Macu”.
   Albo wpisz adres i token w Ustawieniach aplikacji.

## Gdzie co leży na Macu

- `~/Library/Application Support/Task Hub/config.json` – adres, token, nazwa komputera (0600),
- `~/Library/Application Support/Task Hub/work/` – katalog roboczy Claude Code (tam też `mcp.json` z konektorem),
- `~/Library/Logs/Task Hub.log` – dziennik (Ustawienia → Pokaż dziennik).
