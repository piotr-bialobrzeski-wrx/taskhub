# Task Hub

Aplikacja do zadań jednej osoby, w której agent (Claude albo GPT, wymiennie) rozbija sprawy na kroki, składa dla każdego kroku panel z uniwersalnych bloków i prowadzi pracę, a klienci MCP (Claude, Claude Code, ChatGPT) dostają z niej zadania i zasady pracy.

Zasady projektu:

- **Kartka papieru, nie integracje.** Task Hub nie ma własnych podpięć do Slacka, ClickUpa czy poczty. Dane z innych aplikacji wchodzą przez klientów MCP jako *fakty* (etykieta, wartość, pochodzenie) i *migawki* (surowe dane z datą pobrania). Agent sam wybiera, co pokazać.
- **UI z klocków.** Panel kroku to lista bloków: tekst, fakty, wątek, szkic z celem wysyłki, lista, media (grafiki, pliki, linki do plików), link, pytanie. Nowa aplikacja zewnętrzna nie wymaga nowego kodu w UI.
- **AI tylko tam, gdzie potrzeba.** Zwykły krok składa się bez modelu. Model pracuje, gdy są migawki do zinterpretowania, szkic do napisania albo raport do odbioru.
- **Zasady pracy w bazie.** Styl, język projektu, jak pisać w danym narzędziu: trzy poziomy (ogólne, projekt, narzędzie), każdy z zakresem widoczności. Klienci trzymają u siebie tylko konfigurację narzędzi.
- **Dostawca modelu wymienny.** `src/lib/ai` prosi o JSON zgodny ze schematem; Claude i GPT to dwie implementacje tego samego interfejsu, z automatycznym przełączeniem przy błędzie przejściowym.

## Stos

Next.js 16 (App Router, akcje serwera) · Postgres (Supabase) z opcjonalnym pgvector · `postgres` (driver) · zod · `@anthropic-ai/sdk` i `openai` · `mcp-handler` (serwer MCP w `/api/mcp`) · vitest.

## Uruchomienie lokalne

```bash
npm install
cp .env.example .env.local        # uzupełnij DATABASE_URL, hasło i sekret, klucz modelu
npm run db:migrate                 # tworzy tabele (dodaj --skip-vectors, gdy baza nie ma pgvector)
npm run dev                        # http://localhost:3000
```

Testy: `npm test` (testy bazy odpalają się tylko z `TEST_DATABASE_URL=postgres://...`), typy: `npm run typecheck`, build: `npm run build`.

## Wdrożenie: Supabase + Vercel (darmowe plany wystarczą)

1. **Supabase** (baza): [supabase.com](https://supabase.com) → New project, region Frankfurt (eu-central-1), zapisz hasło bazy; w sekcji Security wyłącz Data API (aplikacja łączy się bezpośrednio). Kliknij **Connect** → zakładka **Transaction pooler** → skopiuj URI, wstaw hasło w miejsce `[YOUR-PASSWORD]`; to jest `DATABASE_URL`. „Direct connection” nie działa z Vercela (tylko IPv6).
2. **Migracje** uruchamiają się same przy buildzie produkcyjnym (`npm run build` najpierw wykonuje `migrate --if-configured`); build podglądu (Preview) na Vercelu je pomija i zostawia o tym wpis w logu. Wdrażaj produkcję pushem na `main`: „Promote to Production” gotowego podglądu nie buduje od nowa, więc nowe migracje by nie poszły. Skrypt zapisuje w tabeli `schema_migrations`, które pliki już poszły, więc kolejne wdrożenia niczego nie psują. Lokalnie: `DATABASE_URL=... npm run db:migrate`. Warstwa wektorowa (pgvector) jest opcjonalna: gdy rozszerzenia nie ma, ta jedna migracja jest pomijana z ostrzeżeniem.
3. **Vercel** (hosting): [vercel.com](https://vercel.com) → Add New Project → wskaż repo GitHub. W *Environment Variables* wpisz zmienne z `.env.example` (`DATABASE_URL`, `TASKHUB_OWNER_EMAIL`, `TASKHUB_PASSWORD`, `TASKHUB_SECRET`, opcjonalnie klucz `ANTHROPIC_API_KEY` i/lub `OPENAI_API_KEY` dla agenta wbudowanego; `APP_URL` można dodać po pierwszym wdrożeniu, gdy znasz adres). Deploy. Każdy push na `main` wdraża nową wersję. Funkcje działają we Frankfurcie (`vercel.json`), blisko bazy.
4. Wejdź na adres aplikacji, zaloguj się hasłem z `TASKHUB_PASSWORD`.

Koszt: Supabase Free (500 MB) i Vercel Hobby wystarczą na długo; płacisz tylko za tokeny modelu.

## Podłączenie klientów przez MCP

Adres konektora: `https://TWOJA-APLIKACJA.vercel.app/api/mcp`. Klienci logują się przez OAuth (strona zgody w Task Hub, potwierdzenie hasłem aplikacji) albo tokenem z *Ustawienia → Połączenia → Token dla klienta bez logowania* (token pokazuje się raz; w bazie jest tylko jego skrót). Każde połączenie widać w Ustawieniach i można je unieważnić.

- **Aplikacja Claude** (przeglądarka, komputer, telefon): Ustawienia Claude → Connectors → Add custom connector → adres jak wyżej → Connect. Działa na subskrypcji, bez klucza API.
- **Claude Code**: `claude mcp add --transport http task-hub https://TWOJA-APLIKACJA.vercel.app/api/mcp`, potem `/mcp` → task-hub → logowanie w przeglądarce. Albo z tokenem: `--header "Authorization: Bearer th_..."`.
- **ChatGPT**: Settings → Connectors → Create → adres jak wyżej, uwierzytelnianie OAuth.

Bez klucza modelu w aplikacji pracę agenta wykonuje podłączony klient: zadanie bez kroków ma przycisk „Rozłóż na kroki w Claude”, krok oddany do Claude ma „Otwórz w Claude”; prompt każe zapisać wynik przez konektor (`add_steps`, `add_facts`, `set_blocks`, `complete_step`).

Narzędzia serwera: `list_tasks`, `get_task` (zadanie z zasadami, kontekstem, pytaniami i listą załączników), `get_rules`, `create_task`, `update_task`, `add_steps`, `update_step`, `set_blocks` (panel kroku z uniwersalnych bloków), `complete_step` (zgłoszenie wyniku kroku z raportem i linkiem), `add_facts`, `add_snapshot` (surowe dane z innej aplikacji, do interpretacji przez agenta), `list_work`, `ask_question`, `get_attachment` (grafika lub plik tekstowy wklejony w doku; grafika wraca jako obraz), `describe_attachment` (podpis i analiza załącznika), `add_rule`.

Załączniki: w doku czatu można wybrać plik z dysku, wkleić zrzut ekranu (Ctrl/Cmd+V) albo przeciągnąć plik. Duże grafiki są zmniejszane w przeglądarce (maks. 1800 px, WebP), limit 4 MB na plik. Pliki leżą w bazie (`attachments.data`) i są serwowane z `/api/files/<id>` tylko po zalogowaniu.

Typowy przebieg: w Task Hub klikasz „Zrób w Claude” przy kroku → otwiera się Claude z gotowym promptem (cel, zasady, wyniki wcześniejszych kroków) → Claude pracuje w swoich konektorach (Slack, ClickUp, Gmail) → na końcu wywołuje `complete_step` albo oddaje raport, który wklejasz. Task Hub odbiera raport, wyciąga linki i, gdy to był ostatni krok, pisze notatkę końcową.

## Kopie zapasowe

Co noc `.github/workflows/backup.yml` robi kopię bazy (`pg_dump`), szyfruje ją kluczami age i wysyła do Backblaze B2, a drugi krok od razu próbuje ją odtworzyć w czystym Postgresie. Działa dopiero po dodaniu sekretów w GitHubie (Settings → Secrets and variables → Actions); ich listę i opis ma nagłówek tego pliku. Bez nich przebieg kończy się uwagą „pominięta”. Ręczne odtworzenie: `age -d -i klucz.txt -o taskhub.dump plik.dump.age`, potem `pg_restore --no-owner --no-privileges -d "$DATABASE_URL" taskhub.dump`.

## Układ kodu

```
supabase/migrations/   schemat bazy (0001 tabele, 0002 wektory, 0003 OAuth, 0004 położenia na kanwie i pytania agenta)
scripts/migrate.ts     aplikuje migracje
src/lib/schema.ts      typy domenowe i uniwersalne bloki (zod)
src/lib/priority.ts    priorytet efektywny z powodami
src/lib/time.ts        kwanty 15 min, kalibracja szacunków z historii
src/lib/repo.ts        warstwa danych (SQL bez ORM)
src/lib/ai/            dostawcy modeli: provider.ts (interfejs), anthropic.ts, openai.ts, index.ts (wybór i przełączanie)
src/lib/agent/         context (kontekst dla agenta), chat (czat i akcje), compose (panel z bloków), notes (raporty, notatka końcowa, szkic), handoff (prompt do Claude)
src/lib/services.ts    operacje złożone wspólne dla UI i MCP
src/app/api/mcp        serwer MCP
src/lib/canvas/        layout (układ kafelków, grupy), vm (modele kafelków: stan, termin, czas)
src/app/               widoki: kanwa zadań, kanwa kroków zadania (panele renderowane na serwerze), zasady, ustawienia, logowanie; actions.ts (akcje serwera)
src/components/canvas/ Canvas (silnik: przeciąganie, strzałki, grupy, zoom), Board (poziom 1), TaskCanvas (poziom 2), widgets (pickery, dok), ui (ikony, pasek priorytetu)
src/components/        BlockRenderer (jeden renderer dla wszystkich bloków, pytania z odpowiedzią), stoper, przyciski
tests/                 vitest
```
