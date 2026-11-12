# Paczka zmian 60: mniej procesora na Vercelu

Status: GOTOWA, NIEWDROŻONA (gałąź claude/project-thread-dvoloh, od main 6844599). Wdrożenie na słowo Piotra.
Wątek: „Zmniejsz zużycie procesora na Vercelu”.

## Diagnoza (2026-11-12)
- Hobby wstrzymał projekt 10.11 (pauza do 10.12): Fluid Active CPU 4 h 5 min / 4 h w 30 dni.
- Wykres dzienny: równe 3–15 min procesora dziennie od 15.10, bez skoków. Średnio ok. 9–10 min/dzień, a limit Hobby to ok. 8 min/dzień.
- To nie jest wyciek ani pętla: to stały koszt pytań w tle. 161 tys. wywołań = ok. 5,4 tys. dziennie.
- Główne źródła z kodu:
  1. Mostek na Macu pyta /api/bridge/work co 15 s w dzień (60 s w nocy) = ok. 4,3 tys. wywołań dziennie na jednego Maca. Każde pytanie robiło 4 zapisy w bazie i co 5 min pełne przeliczenie listy pracy.
  2. Otwarta strona Task Hub (okno w aplikacji na Macu, telefon) pyta /api/pulse co 15 s (co 3 s, gdy agent pracuje) i przy zmianie odświeża całą stronę (najcięższe wywołanie) najwyżej co 10 s.
  3. Wywołania MCP z biegów agenta i automatu (każde buduje serwer z 41 narzędziami).
- Gałęzie podglądu (claude/project-thread-*) NIE zużywają procesora: podgląd liczy się tylko, gdy ktoś go otworzy.

## Zmiany
1. Mostek pyta co 30 s w dzień (było 15 s), w nocy bez zmian 60 s. Serwer podaje odstęp, więc nie trzeba nowej wersji aplikacji na Maca. „Sprawdź teraz” działa od razu jak dotąd.
2. Pytanie mostka nie zapisuje w bazie przy każdym wywołaniu: meta i odcisk dostępu tylko przy zmianie (meta co najmniej raz na minutę), sprzątanie zawieszonych biegów raz na minutę.
3. Pełne przeliczenie listy pracy bez zmian w bazie co 10 min (było 5).
4. Strona: puls co 30 s (było 15 s), co 5 s gdy agent pracuje (było 3 s); odświeżenie po zmianie w bazie najwyżej co 20 s (było 10 s).
5. Licznik procesora: każde wywołanie mostka, pulsu, MCP (z nazwą narzędzia) i strony zostawia w Vercel Logs linię „[cpu] trasa ms=…”. Po wdrożeniu widać czarno na białym, co kosztuje najwięcej.

## Szacunek
- Wywołania: mostek −50%, puls −50% → ok. 2,5–3 tys. dziennie zamiast 5,4 tys.
- Procesor: ok. −40% (z ok. 10 do ok. 6 min/dzień), czyli poniżej limitu Hobby. Pewność średnia, liczby da licznik z punktu 5.

## Czego Piotr zauważy
- Krok zlecony agentowi rusza do 30 s później (było do 15 s).
- Dymek „Claude pracuje” odświeża się co ok. 20 s zamiast 10 s.

## Sprawdzenie
- tsc bez błędów, testy: 449 zielonych (196 pominiętych bez bazy).
- Po wdrożeniu: Vercel → taskhub → Logs, szukaj „[cpu]”.
