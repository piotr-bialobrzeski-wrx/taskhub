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

1. **Supabase** (baza): [supabase.com](https://supabase.com) → New project, region Frankfurt, zapisz hasło bazy. W *Project Settings → Database → Connection string* wybierz tryb **Transaction** (pooler, port 6543) i skopiuj adres jako `DATABASE_URL`. W *SQL Editor* uruchom `create extension if not exists vector;` (jedno kliknięcie, pozwala na warstwę wektorową).
2. **Migracje**: lokalnie `DATABASE_URL=... npm run db:migrate`. Skrypt zapisuje w tabeli `schema_migrations`, które pliki już poszły, więc można go uruchamiać wielokrotnie.
3. **Vercel** (hosting): [vercel.com](https://vercel.com) → Add New Project → wskaż repo GitHub. W *Environment Variables* wpisz wszystkie zmienne z `.env.example` (`DATABASE_URL`, `TASKHUB_OWNER_EMAIL`, `TASKHUB_PASSWORD`, `TASKHUB_SECRET`, klucz `ANTHROPIC_API_KEY` i/lub `OPENAI_API_KEY`, `APP_URL` = adres z Vercela). Deploy. Każdy push na `main` wdraża nową wersję.
4. Wejdź na adres aplikacji, zaloguj się hasłem z `TASKHUB_PASSWORD`.

Koszt: Supabase Free (500 MB) i Vercel Hobby wystarczą na długo; płacisz tylko za tokeny modelu.

## Podłączenie klientów przez MCP

W aplikacji: *Ustawienia → Klienci MCP → Nowy token*. Token pokazuje się raz; w bazie jest tylko jego skrót.

Claude Code:

```bash
claude mcp add --transport http task-hub https://TWOJA-APLIKACJA.vercel.app/api/mcp --header "Authorization: Bearer th_..."
```

Claude (aplikacja) i ChatGPT: dodaj własny konektor MCP z adresem `https://TWOJA-APLIKACJA.vercel.app/api/mcp` i nagłówkiem `Authorization: Bearer th_...`.

Narzędzia serwera: `list_tasks`, `get_task` (zadanie z zasadami i kontekstem), `get_rules`, `create_task`, `update_task`, `add_steps`, `update_step`, `complete_step` (zgłoszenie wyniku kroku z raportem i linkiem), `add_facts`, `add_snapshot` (surowe dane z innej aplikacji, do interpretacji przez agenta), `add_rule`.

Typowy przebieg: w Task Hub klikasz „Zrób w Claude” przy kroku → otwiera się Claude z gotowym promptem (cel, zasady, wyniki wcześniejszych kroków) → Claude pracuje w swoich konektorach (Slack, ClickUp, Gmail) → na końcu wywołuje `complete_step` albo oddaje raport, który wklejasz. Task Hub odbiera raport, wyciąga linki i, gdy to był ostatni krok, pisze notatkę końcową.

## Kopie zapasowe

Supabase robi codzienne kopie na płatnych planach; na Free zrób własne: `pg_dump "$DATABASE_URL" > taskhub-$(date +%F).sql` z crona na własnym komputerze albo z GitHub Actions z sekretem. Przywracanie: `psql "$DATABASE_URL" < plik.sql`.

## Układ kodu

```
supabase/migrations/   schemat bazy (0001 tabele, 0002 wektory)
scripts/migrate.ts     aplikuje migracje
src/lib/schema.ts      typy domenowe i uniwersalne bloki (zod)
src/lib/priority.ts    priorytet efektywny z powodami
src/lib/time.ts        kwanty 15 min, kalibracja szacunków z historii
src/lib/repo.ts        warstwa danych (SQL bez ORM)
src/lib/ai/            dostawcy modeli: provider.ts (interfejs), anthropic.ts, openai.ts, index.ts (wybór i przełączanie)
src/lib/agent/         context (kontekst dla agenta), chat (czat i akcje), compose (panel z bloków), notes (raporty, notatka końcowa, szkic), handoff (prompt do Claude)
src/lib/services.ts    operacje złożone wspólne dla UI i MCP
src/app/api/mcp        serwer MCP
src/app/               widoki: kanwa, zadanie, zasady, ustawienia, logowanie; actions.ts (akcje serwera)
src/components/        Prio, BlockRenderer (jeden renderer dla wszystkich bloków), czat, stoper
tests/                 vitest
```
