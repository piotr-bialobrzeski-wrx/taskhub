# Task Hub na Maca

Natywna aplikacja (Swift, AppKit + WebKit + SwiftUI), odpowiednik Claude Code Quick z Project Hub, ale z mostkiem w środku:

- **okno z Task Hub** (aplikacja webowa w WKWebView, logowanie zapamiętane, linki na zewnątrz idą do przeglądarki),
- **ikona w pasku menu** ze stanem mostka (czuwa / Claude pracuje / limit / wylogowany), „Sprawdź teraz”, „Nowe zadanie…”,
  a w trakcie biegu „Zatrzymaj bieg”,
- **okienko „Nowe zadanie”** pod ⌃⌥T z każdego miejsca (⌘N w aplikacji): wklej maila albo opis, ⌘↩ wysyła, Claude zaczyna od razu,
- **mostek**: co kilkanaście sekund pyta Task Hub tanim HTTP (`GET /api/bridge/work`, zero tokenów), a gdy czeka praca,
  bierze bieg (`POST /api/bridge/run`) i uruchamia Claude Code na subskrypcji (ANTHROPIC_API_KEY celowo nieustawione),
  przekazuje użycia narzędzi jako postęp i zgłasza wynik (`PATCH /api/bridge/run/:id`). Zasady biegu niżej,
- **powiadomienie o biegu**: „Claude pracuje na tym Macu” z przyciskiem „Zatrzymaj” (to samo co „Zatrzymaj bieg” w pasku menu),
- **Ustawienia** (⌘,): adres, token mostka, ścieżka do Claude Code, model, foldery z kodem, start po zalogowaniu (SMAppService), dziennik,
- **rejestr połączeń**: po starcie i co 6 godzin (albo po „Sprawdź teraz”) wysyła do Task Hub listę serwerów MCP z `claude mcp list`
  (`POST /api/bridge/connections`: nazwy, adresy i stan, nigdy tokeny), więc agent wie, czym dysponuje z tego Maca
- **samoaktualizacja**: co 6 godzin pyta Task Hub (`GET /api/bridge/app` z tokenem mostka) o najnowsze wydanie, pobiera `.zip`
  przez Task Hub (działa też przy prywatnym repozytorium), sprawdza sumę SHA-256 z wydania, podmienia `/Applications/Task Hub.app`
  (stara wersja do Kosza) i uruchamia się ponownie, gdy okna są zamknięte i mostek nie pracuje (inaczej pyta). Bez prawa zapisu
  w /Applications otwiera instalator `.pkg`. Publiczne API GitHuba tylko, gdy serwer nie zna jeszcze tej ścieżki (404) albo aplikacja
  nie jest połączona. Wyłączalna w Ustawieniach,
- link `taskhub://connect?url=…&token=…` z Ustawień Task Hub wpisuje adres i token bez przepisywania, ale zawsze po pytaniu
  „Połączyć tę aplikację z Task Hub pod adresem …?”. Połączona aplikacja przyjmuje link tylko z tego samego hosta; adres musi być https.

Mostek pracuje także przy zamkniętym oknie (aplikacja zostaje w pasku menu). Gdy Mac śpi, pracę przejmuje automat co godzinę.

## Co mostek może, a czego nie (od 0.1.7)

- **Bez `bypassPermissions`.** Bieg idzie z `--permission-mode dontAsk` i listą dozwolonych narzędzi; czego nie ma na liście, Claude
  nie użyje. Konektor Task Hub dostaje krótki token biegu od serwera (nigdy token mostka), pliki biegu leżą w `run/`, poza katalogiem roboczym.
- **Zewnętrzne aplikacje (Slack, Gmail, ClickUp, Kalendarz, Dysk) w zwykłym biegu tylko do odczytu.** Każda zmiana na zewnątrz
  (wiadomość, komentarz, zmiana zadania) powstaje jako szkic do zatwierdzenia w Task Hub.
- **Wysyłka osobno.** Zatwierdzony przez Ciebie szkic wysyła osobny, krótki bieg: jeden szkic, tylko konektor docelowej aplikacji,
  nic poza tym. Commit i push robi sama aplikacja (`git add/commit/push` dokładnie na plikach ze szkicu, bez modelu i bez force).
  Przed commitem porównuje zmiany każdego pliku z diffem, który zatwierdziłeś (inne = nic nie commituje), a push wysyła tylko
  commity, które sama zrobiła po Twojej zgodzie. „Zatrzymaj” na karcie szkicu w Task Hub przerywa trwającą wysyłkę przy najbliższym sygnale.
- **Foldery z kodem** (Ustawienia → Foldery z kodem): tylko w nich Claude zmienia pliki i uruchamia testy w krokach z kodem.
  Bez folderu krok z kodem wraca do Ciebie z prośbą o dodanie. Dodawaj główny folder repozytorium (ten z katalogiem `.git`), nie podfolder.
  Aplikacja nie przyjmie całego dysku, katalogu domowego, Biblioteki, ukrytych folderów w katalogu domowym ani folderów systemowych.
  W folderach z kodem piaskownica nie pozwala zapisywać `.git/hooks`, `.git/config`, `.git/info`, `.gitmodules`, `.claude`, `.mcp.json`,
  `.vscode` ani `.idea` (to, co mogłoby uruchomić program poza piaskownicą).
- **Commit z aplikacji** pomija haki repozytorium (`core.hooksPath=/dev/null`, więc np. husky czy lint-staged nie ruszą) i odmawia,
  gdy `.git/config` repozytorium ma ustawienia, które uruchamiają programy albo kierują push gdzie indziej (`include`, `url.*`,
  `credential.helper`, filtr inny niż git-lfs/git-crypt, `core.sshCommand`, `pushurl`, `http.proxy` i podobne). Komunikat mówi, który klucz.
- **Nigdy:** `git push`, `git commit` (i inne polecenia, które robią commity albo przestawiają gałąź) z modelu, czytanie plików poza `work/` i folderami z kodem,
  `curl`/`ssh`/`scp`, `sudo`, `osascript`, `open`, `security`, czytanie kluczy i haseł
  (`~/.ssh`, `~/.aws`, `~/.docker`, `~/.kube`, `~/.gnupg`, `~/.pgpass`, historia powłoki, pęk kluczy, dane tej aplikacji, ciasteczka). Pilnują tego lista narzędzi, piaskownica Claude Code i strażnik
  (`Task Hub --hook-guard`, hak PreToolUse).
- **Konektor, który doszedł po próbie** (od 0.1.8): mostek co 6 h robi próbę Claude Code (jakie narzędzia i konektory ma). Konektor,
  który przy próbie jeszcze się łączył (np. Figma), a w biegu już jest, nie ma reguły w ustawieniach biegu, więc jego narzędzia blokuje
  strażnik z listy narzędzi biegu (`TASKHUB_ALLOWED_TOOLS`); bieg idzie dalej bez niego, a przed następnym biegiem mostek robi nową próbę.
  Do 0.1.7 taki bieg był przerywany i mostek stawał na 10 minut.
- **Zatrzymaj**: przycisk w powiadomieniu albo „Zatrzymaj bieg” w pasku menu przerywa bieg (z procesami potomnymi), Task Hub dostaje
  wynik „zatrzymany”, a mostek odczekuje 10 minut. „Sprawdź teraz” wznawia od razu.
- Okno Task Hub otwiera na zewnątrz tylko `http(s)`, `mailto` i `tel`; inne schematy (np. `file:`) są blokowane.

## Pliki

- `Sources/` – kod: `App.swift` (start, @main, wejście strażnika), `AppDelegate.swift` (menu, pasek menu, okna, link taskhub://), `WebWindow.swift` (okno z aplikacją),
  `QuickEntry.swift` (szybkie zadanie), `SettingsView.swift` (ustawienia), `Bridge.swift` (pętla mostka), `ProcessRunner.swift` (bieg Claude Code,
  stream-json, strażnik czasu), `ClaudeCLI.swift` (szukanie Claude Code, środowisko, limit/wylogowanie), `Policy.swift` (zasady biegu: narzędzia, ustawienia),
  `Guard.swift` (strażnik `--hook-guard`), `GitSend.swift` (commit i push bez modelu), `Notifier.swift` (powiadomienie z „Zatrzymaj”),
  `Store.swift` (config.json, foldery z kodem), `HotKey.swift` (⌃⌥T), `Theme.swift` (kolory i pigułki z aplikacji webowej), `Log.swift` (dziennik),
  `Updater.swift` (samoaktualizacja przez Task Hub, SHA-256).
- `VERSION` – numer wersji aplikacji (podbicie = nowe wydanie).
- `Info.plist` – tożsamość (`com.taskhub.app`), schemat `taskhub`, macOS 13+, powiadomienia jako alerty (przycisk „Zatrzymaj” widać od razu).
- `Icon/icon-1024.png` – ikona; `build.sh` robi z niej `AppIcon.icns`.
- `build.sh` – budowa (arm64 + x86_64), podpis ad hoc, `.pkg` (instaluje do /Applications) i `.dmg`.
- `.github/workflows/mac-app.yml` – budowa na GitHub Actions (macos-14) i wydanie na GitHubie (z plikami `<nazwa>.sha256`).

## Budowa

Na Macu z Xcode Command Line Tools: `macos/build.sh 0.1.0`. Wynik w `macos/build/`.

Na GitHubie: wersja siedzi w `macos/VERSION`. Push do `main` z nową wersją buduje właściwe wydanie `app-v<wersja>` (tag zakłada sam
GitHub Actions, bo push tagów z sesji w chmurze jest zablokowany), które Task Hub podaje aplikacjom (`/api/bridge/app`) i pod linkiem
„Pobierz aplikację” w Ustawieniach (`/api/app/download`). Kolejne pushe z tą samą wersją odświeżają wydanie wstępne `app-latest`. Nowa wersja dla Piotra = podbij `macos/VERSION`.

## Instalacja u użytkownika

1. Pobierz `.pkg` z wydania i otwórz. Aplikacja nie jest notaryzowana (podpis ad hoc), więc przy pierwszym otwarciu:
   Ustawienia systemowe → Prywatność i ochrona → „Otwórz mimo to”.
2. Zainstaluj Claude Code i zaloguj się raz w Terminalu: `claude`, potem `/login`.
3. W Task Hub (przeglądarka) → Ustawienia → Mostek na komputerze → token → „Połącz aplikację Task Hub na tym Macu”
   i potwierdź adres w oknie aplikacji. Albo wpisz adres i token w Ustawieniach aplikacji.
4. Kroki z kodem: Ustawienia aplikacji → Foldery z kodem → „Dodaj folder…” (repozytoria, w których Claude może pracować).
5. Przy pierwszym uruchomieniu macOS zapyta o powiadomienia: zgoda daje przycisk „Zatrzymaj” w rogu ekranu (bez niej zostaje pasek menu).

## Gdzie co leży na Macu

- `~/Library/Application Support/Task Hub/config.json` – adres, token, nazwa komputera, foldery z kodem (0600),
- `~/Library/Application Support/Task Hub/work/` – katalog roboczy Claude Code,
- `~/Library/Application Support/Task Hub/run/` – pliki pojedynczego biegu (konfiguracja MCP z tokenem biegu, ustawienia; 0700, kasowane po biegu),
- `~/Library/Logs/Task Hub.log` – dziennik (Ustawienia → Pokaż dziennik).
