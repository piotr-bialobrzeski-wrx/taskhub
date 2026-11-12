# Paczka zmian 60: sygnał w chwili zmiany zamiast odpytywania (procesor na Vercelu)

Status: GOTOWA, NIEWDROŻONA. Gałąź claude/project-thread-dvoloh (od main 6844599). Wdrożenie na słowo Piotra, po przejściu na Vercel Pro.
Wątek: „Zmniejsz zużycie procesora na Vercelu”. Aplikacja na Maca 0.1.26.

## Diagnoza (2026-11-12)
- Vercel Hobby wstrzymał projekt 10.11 (pauza do 10.12): Fluid Active CPU 4 h 5 min / 4 h w 30 dni.
- Wykres dzienny: równe 3–15 min procesora dziennie od 15.10, bez skoków (średnio ok. 10 min/dzień, limit Hobby ok. 8 min/dzień).
- To stały koszt pytań w tle, nie wyciek. 161 tys. wywołań ≈ 5,4 tys. dziennie:
  1. mostek na Macu pytał /api/bridge/work co 15 s w dzień (≈4,3 tys./dzień), przy każdym pytaniu 4 zapisy w bazie, co 5 min pełne przeliczenie listy pracy;
  2. okno Task Hub (w aplikacji na Macu) pytało /api/pulse co 15 s (co 3 s, gdy agent pracuje) i odświeżało całą stronę po zmianie;
  3. MCP z biegów agenta i automatu.
- Gałęzie podglądu nie zużywają procesora (podgląd liczy się tylko po otwarciu).

## Dlaczego odpytywanie (lekcja)
- Mostek skopiowano z Project Hub, gdzie serwer jest lokalny i pytanie nic nie kosztuje. Na Vercelu każde pytanie to wywołanie funkcji.
- 2026-11-06 (analiza strumieni zdarzeń) Supabase Realtime przegrało z odpytywaniem, bo liczono tylko transfer z Supabase, nie procesor Vercela.
- Zasada na przyszłość (do dopisania w Task Hub przy wdrożeniu): wszystko, co działa stale w tle, dostaje wyliczenie kosztu na Vercelu i w Supabase; odpytywanie tylko, gdy sygnał w chwili zmiany jest niemożliwy.

## Zmiany
1. Baza (migracja 0038): wyzwalacz na tasks, steps, zależnościach, chat_messages, questions, time_samples, projects, users, bridge_runs, facts
   wysyła przez Supabase Realtime (realtime.send, kanał publiczny o losowej tajnej nazwie users.live_topic) sygnał {t: tabela} bez danych.
   Jeden sygnał na transakcję i tabelę. Bez Realtime albo przy błędzie: nic, zapis działa dalej (testy).
2. Strona (LivePoll): słucha kanału; po sygnale jedno pytanie /api/pulse (kilka sygnałów naraz = jedno pytanie), odświeżenie jak dotąd.
   Przy działającym kanale pytanie kontrolne co 2 min (stan Maca). Gdy pytanie kontrolne znajdzie zmianę bez sygnału, strona wraca do starego rytmu (3 s / 15 s).
3. Mostek (aplikacja 0.1.26, Live.swift): słucha kanału; sygnał budzi go od razu, poza tym pyta co 5 min. Zmiana bez sygnału → wraca do pytania co 15 s.
   Stara aplikacja (0.1.25) działa jak dotąd.
4. Pytanie mostka mniej zapisuje: meta i odcisk dostępu tylko przy zmianie, sprzątanie biegów raz na minutę; pełne przeliczenie bez zmian co 10 min (było 5).
5. Licznik procesora: linie „[cpu] trasa ms=…” w Vercel Logs dla mostka, pulsu, MCP (z nazwą narzędzia) i stron.

## Co Piotr musi zrobić przy wdrożeniu (jeden krok)
- Supabase → projekt → Project Settings → API Keys → skopiować klucz „Publishable” (albo „anon”).
- Vercel → taskhub → Settings → Environment Variables → dodać SUPABASE_PUBLISHABLE_KEY = ten klucz → Redeploy.
- Klucz jest publiczny z założenia; tabele mają RLS bez polityk (migracja 0017), więc nie daje dostępu do danych.
- Potem: aktualizacja aplikacji na Maca do 0.1.26.

## Szacunek
- Wywołania w tle: z ≈5,4 tys. do kilkuset dziennie (−80–90%); procesor w tle prawie do zera, zostaje praca przy prawdziwych zmianach.
- Zmiany na stronie i start agenta szybciej niż dziś (sygnał <1 s zamiast do 15 s).
- Supabase Free: Realtime do 200 połączeń i 2 mln wiadomości/mies.; tu 2–3 połączenia i kilka tys. sygnałów dziennie.

## Sprawdzenie
- tsc bez błędów; vitest 649/649 na lokalnym Postgresie (z p60-sygnal: wyzwalacz, jeden sygnał na transakcję, zapis bez Realtime).
- Budowa aplikacji na Maca: workflow na gałęzi mac-check-p60.
- Po wdrożeniu: log aplikacji „sygnał: kanał zmian działa”; w Vercel Logs „[cpu]”; Usage → Fluid Active CPU dziennie.
- Ryzyko: Realtime nie potwierdzone na prawdziwym Supabase (kanał publiczny musi być dozwolony w Realtime Settings). Gdy sygnał nie dochodzi, oba klienty same wracają do odpytywania.
