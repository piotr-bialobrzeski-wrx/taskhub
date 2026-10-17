# Jak Project Hub uruchamia Claude od razu — analiza i plan dla Task Hub

Źródło: kod zainstalowanej aplikacji `~/Applications/Project Hub.app` (pliki `bridge/bridge.mjs`, `bridge/limits.mjs`, `bridge/README.md`, serwer `dist-server/index.mjs`) oraz `~/world/automation` (runner `heartbeat.js`) na Twoim Macu, przeczytane 2026-10-16.

## 1. Jak to działa w Project Hub

1. **Wszystko jest lokalne.** Project Hub to aplikacja na Macu z własnym serwerem na `localhost:4820` i bazą SQLite. Ma trzy tryby pracy: `offline` (lokalny model), `online` (klucz API, płatne tokeny) i `bridge` (Claude Code na subskrypcji). Ty używasz `bridge`.
2. **Kolejka zamiast wołania Claude.** Gdy coś wpada (wiadomość w czacie Hubberta, nowe zadanie z Claude Code Quick przez `/public/webhooks/inbox`, analiza ticketu, plan dnia), serwer tylko dopisuje wiersz do tabeli `chat_jobs` ze statusem `pending` i od razu oznacza zadanie jako „Analiza w trakcie”.
3. **Mostek odpytuje bez tokenów.** Aplikacja przy starcie uruchamia skrypt `bridge.mjs` (Node, bez zależności). Co 2 sekundy pyta `GET /public/chat/pending` zwykłym HTTP. To nic nie kosztuje. Co 10 sekund wysyła „puls”, dzięki czemu aplikacja wie, czy mostek żyje, i pokazuje ostrzeżenie, gdy nie.
4. **Dopiero praca budzi Claude.** Gdy w kolejce jest zadanie, mostek uruchamia lokalnie `claude -p "<prompt>" --output-format stream-json --permission-mode bypassPermissions --append-system-prompt <persona Hubberta> [--resume <sesja projektu>]`. Claude Code działa na Twojej subskrypcji (zmienna `ANTHROPIC_API_KEY` celowo pusta), z Twoimi konektorami i skillami z Claude Code. Każde użycie narzędzia mostek przekazuje do aplikacji jako postęp, a wynik wpisuje przez `POST /public/chat/:id/reply`.
5. **Obsługa awarii.** Limit subskrypcji: zadanie czeka do końca okna (`parseLimit`). Wylogowany Claude Code: zadania czekają na `/login`. Zgubiona sesja: zaczyna nową. Brak jakiegokolwiek sygnału przez 10 minut: proces ubity, zadanie wraca. Jeden mostek naraz (plik blokady), zadania po kolei.
6. **Zatwierdzanie.** Prompt Hubberta mówi wprost: niczego nie wysyłać na Slacka ani do ClickUp samodzielnie, każda wysyłka wyłącznie po zatwierdzeniu w Project Hub (tabela `proposals`: proposed, approved, sent, rejected). To ten sam model, który ma Task Hub (szkic → „Zatwierdź i wyślij”).
7. **Osobno: joby w `world`.** `heartbeat.js` z launchd co 15 minut odpala `claude -p` dla zadań z harmonogramu (cron w plikach `.md`) i z folderu `inbox/`. To odpowiednik naszego zadania zaplanowanego, tylko lokalny: ma „doganianie” po śnie Maca, budzenie przez `pmset`, `caffeinate` na czas pracy i alerty na Slack DM.

## 2. Czy działa „od razu”?

Tak, z projektu kodu wynika opóźnienie rzędu kilku sekund: do 2 s na odebranie z kolejki plus start Claude Code. Warunki: aplikacja Project Hub uruchomiona (to ona trzyma mostek), Mac nie śpi, Claude Code zalogowany, limit subskrypcji niewyczerpany. Logów działania nie sprawdzałem (są poza udostępnionymi folderami), więc potwierdzam mechanizm, nie statystyki.

## 3. Czy spełnia wymagania Task Hub?

| Wymaganie | Project Hub | Wniosek dla Task Hub |
|---|---|---|
| Praca rusza od razu, bez okna Claude i kopiowania promptu | Tak | Przenosimy 1:1 (mostek) |
| Brak opłat za tokeny | Tak, subskrypcja; przy limicie czeka | Tak samo |
| Claude i GPT wymiennie | Częściowo: tryby offline/online/bridge, ale mostek zna tylko `claude` | Mostek Task Hub dostanie wymienny „silnik”: `claude -p` albo komenda Codex na subskrypcji ChatGPT |
| Aplikacja w chmurze, dostępna z każdego miejsca i telefonu | NIE: wszystko na Macu, bez aplikacji nic nie działa | Task Hub zostaje w chmurze; lokalny jest tylko wykonawca. Gdy Mac śpi, pracę przejmuje obecny automat co godzinę |
| Publikacja tylko po zatwierdzeniu | Tak | Już mamy |
| Bezpieczeństwo | Token w adresie URL na localhost; `bypassPermissions` daje Claude pełną autonomię na Macu | Mostek łączy się wychodząco po HTTPS z własnym tokenem (bez otwierania portów); zapis do Task Hub tylko przez konektor; `bypassPermissions` jak w Project Hub, bo bez tego Claude Code w tle nie użyje narzędzi |
| Kopie, własna baza, brak uzależnienia od jednej chmury | Lokalny SQLite | Bez zmian w Task Hub |

## 4. Dlaczego nie „60 zadań zaplanowanych co minutę”

Zadanie zaplanowane to za każdym razem pełna sesja Claude (prompt, konektor, rozumowanie, odpowiedź), więc samo „sprawdzenie, czy jest praca” zużywa tokeny z limitu i zakłada wątek w projekcie. Przy 60 sesjach na godzinę to około 1000 sesji dziennie za tę samą pracę. W Project Hub sprawdzanie robi zwykły program za darmo, a Claude rusza tylko do realnej pracy. To właściwy podział.

## 5. Co buduję w Task Hub (runda 8)

**Po stronie aplikacji (chmura):**
- Token mostka: w Ustawieniach → Połączenia sekcja „Mostek na komputerze” z przyciskiem tworzącym token (pokazany raz) i statusem: „działa, ostatni sygnał X s temu, komputer Y” albo „nieaktywny, pracę przejmuje automat co godzinę”.
- Dwa lekkie punkty wejścia dla mostka (HTTPS, nagłówek Bearer, bez modelu): `GET /api/bridge/work` (jest praca? plus puls) i `POST /api/bridge/run` (atomowe „biorę pracę”, żeby dwa komputery nie robiły tego samego; zgłoszenie końca; stary bieg wygasa po 15 min bez sygnału).
- Automat co godzinę staje z boku, gdy mostek żyje: `list_work` wywołane spoza mostka odpowiada „mostek pracuje na bieżąco, nic nie rób”, więc taki bieg kończy się w sekundy.
- Komunikat w czacie po dodaniu zadania mówi, kto się nim zajmie: „Claude zaczyna pracę” (mostek żyje) albo „Claude zagląda tu co godzinę”.

**Po stronie Maca (jak w Project Hub):**
- `bridge/taskhub-bridge.mjs` w repo: Node bez zależności, co 10 s pyta Task Hub, gdy jest praca uruchamia `claude -p` z konektorem Task Hub podanym przez `--mcp-config` (zero ręcznej konfiguracji w Claude Code) i Twoimi lokalnymi konektorami, w trybie `bypassPermissions`. Obsługa limitu, wylogowania, zawieszenia, jednej instancji, kolejność. Silnik wymienny przez ustawienie (`claude` albo komenda Codex).
- Instalacja jedną komendą: `node taskhub-bridge.mjs --install` zapisuje i ładuje LaunchAgent (start po zalogowaniu, auto-restart). Log w `~/Library/Logs/taskhub-bridge.log`.

**Czego będę potrzebować od Ciebie na końcu:** na Macu zalogowany Claude Code (`claude` → `/login`), token mostka z Ustawień Task Hub i uruchomienie komendy instalacyjnej. Resztę robię sam.
