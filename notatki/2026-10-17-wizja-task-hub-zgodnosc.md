# Wizja Task Hub a obecna architektura: co pasuje, co trzeba dołożyć, co zmienić

Data: 2026-10-17. Źródło: doprecyzowanie Piotra z 17.10 (pomocnik na lata, niezależny od firmy; kilka firm naraz; zasady zostają z Piotrem; projekty firm i własne; transkrypty i autorefleksja; teksty na LinkedIn i Medium; konektor Pirxey World plus wiele kont tej samej aplikacji; wszystkie kalendarze i kompetencje; samouczenie zasad; prywatne osobno od zawodowych; poranny przegląd i plan dnia pod kalendarz i rytm pracy).

## 1. Werdykt w skrócie

Model zasad (profil, zasada, procedura, historia wersji) pasuje i zostaje. Treść v3 pozostaje ważna; po dołożeniu „firmy” jako osobnego poziomu dwa wpisy zmienią zakres, co zrobię skryptem. Dochodzą cztery rzeczy: poziom firmy nad projektem, rozróżnienie prywatne i zawodowe, pętla uczenia (propozycje zmian zasad z dowodami) oraz dwa nowe profile (rytm pracy, kompetencje).

Architektura integracji wymaga zmiany werdyktu z wczoraj. Wczoraj radziłem: rejestr połączeń teraz, brama MCP w Task Hub może kiedyś. Wiele kont tej samej aplikacji (kilka Gmaili, Slacków, Figm, kalendarzy), kilka firm naraz i „dostęp do wszystkich moich kalendarzy” nie da się zrobić na konektorach klienta: konektor Gmaila w aplikacji Claude to jedno konto, a w Claude Code na Macu drugie konto tej samej aplikacji to ręczna żonglerka konfiguracją. Połączenia (konto w aplikacji, z etykietą, firmą i sferą) muszą być bytem Task Hub. Celem jest więc brama (B), a rejestr (C) jest pierwszym krokiem, nie końcem.

## 2. Wymagania i ich pokrycie

| Nr | Wymaganie | Dziś | Ocena | Co zrobić |
| --- | --- | --- | --- | --- |
| 1 | Pomocnik na lata, niezależny od firmy | Task Hub na prywatnym Vercelu i Supabase, repo z aliasem prywatnym; silnik na koncie Claude piotr.bialobrzeski@pirxey.com | luka | sprawdzić, kto płaci za konto Claude; jeśli firma, prywatne konto i przeniesienie rutyny i mostka (pytanie 1) |
| 2 | Kilka firm naraz; zasady zostają z Piotrem i są dzielone z firmą | zakresy: ogólna, projekt, narzędzie; brak poziomu firmy; „Pirxey & Widelab” udaje projekt; pole visibility nieużywane | luka | byt „firma” (organizacja) nad projektem, zakres zasady „firma”; zasady zawsze w bazie Piotra; eksport zasad danej firmy do pliku, gdy chce się nimi podzielić |
| 3 | Projekty firm zewnętrznych i własne | projekty bez przypisania do firmy ani sfery | luka | projekt należy do firmy albo jest prywatny; sfera (zawodowa, prywatna) wynika z tego automatycznie |
| 4 | Transkrypty rozmów i autorefleksja | brak miejsca; załączniki i migawki tylko przy zadaniach | do dołożenia | „Dziennik”: wpisy (transkrypt, źródło, data, firma, projekt, uczestnicy) z analizą agenta (co poszło dobrze, co źle, nad czym pracować) i „Wnioski” z dowodami; źródła: Fireflies przez Pirxey World, pliki z Meet albo Drive, wklejenie, dyktowanie w aplikacji na Macu |
| 5 | Teksty na LinkedIn i Medium z wniosków | krok z narzędziem linkedin i szkic do zatwierdzenia już istnieją | zgodne, do uzupełnienia | projekt prywatny „Obecność” z procedurą stylu postów; „Wnioski” jako źródło pomysłów; publikacja wyłącznie z zatwierdzonego szkicu |
| 6 | Pirxey World jako konektor zbiorczy plus własne, wielokrotne połączenia do tej samej aplikacji | narzędzie kroku to nazwa aplikacji bez konta; agent używa tego, co ma jego klient | do zmiany | „Połączenia” jako byt: aplikacja, etykieta, konto, firma, sfera, kto je dostarcza (konektor Claude, Claude Code na Macu, Pirxey World, własne połączenie Task Hub); krok i szkic wskazują połączenie, nie tylko aplikację |
| 7 | Dostęp do wszystkich kalendarzy i kompetencji, żeby doradzać | brak kalendarzy w Task Hub; kompetencje w firmowym repo world | do zmiany | kalendarze jako połączenia tylko do odczytu (prywatne adresy iCal, bez OAuth, dowolna liczba kont); profil „Kompetencje” jako dane Piotra |
| 8 | Samouczenie zasad, procedur i profili | historia wersji; walidatory i „to jest wzór” zaplanowane | do dołożenia | pętla uczenia: agent zapisuje sygnały (poprawki szkiców przed zatwierdzeniem, uwagi z czatu, powody leave_step, wnioski z dziennika), co tydzień proponuje zmiany zasad z dowodami; przyjęcie jednym dotknięciem albo automat z powiadomieniem (pytanie 2) |
| 9 | Prywatne osobno od zawodowych | zasada 10 mówi o tym w prozie; mechanicznie nic | luka | sfera na firmie, projekcie, połączeniu i wpisie dziennika; agent dostaje do kontekstu tylko jedną sferę naraz; przegląd pokazuje obie, ale osobno |
| 10 | Poranek: zebrać, posegregować, odrzucić, plan pod kalendarz i rytm | rutyna co godzinę, list_work, priorytet efektywny, szacunki w kwadransach, kalibracja czasu | do dołożenia | bieg poranny: zebranie sygnałów, karta decyzji dla spraw na granicy, plan dnia z wolnych okien kalendarza i rytmu (profil „Mój rytm”), widok „Dzień”; tryb kroku: wykonanie albo analiza i kreacja |

## 3. Model zasad: co zostaje, co dochodzi

Zostaje: trzy rodzaje, wyzwalacze, historia wersji, składanie promptu w sekcje, zasady w bazie Task Hub jako jedyne źródło. Treść v3 bez zmian.

Dochodzi:

- Zakres „firma”. Profil „Firma: Pirxey & Widelab” i procedura „pytanie o firmę” przechodzą na ten zakres, projekt „Pirxey & Widelab” zostaje jako „sprawy firmowe” wewnątrz firmy. Nowa firma (Veloza) dostaje własny profil: język, workspace Slack, ton, narzędzia. Agent dostaje profil firmy przy każdym zadaniu jej projektu.
- Sfera: zawodowa albo prywatna, wynika z firmy albo z braku firmy. Zasady ogólne obowiązują w obu; zasady i profile firmy tylko w zawodowej; projekt prywatny nie widzi niczego firmowego.
- Pochodzenie zasady: „moja” albo „wypracowana w firmie X”. To pole, nie osobny poziom. Pozwala po latach zobaczyć, co skąd przyszło, i wyeksportować firmie to, co jej dotyczy, bez reszty.
- Dwa nowe profile ogólne jako dane: „Mój rytm” (rano praca nad rozpisanymi tematami, około 16 okno kreatywne, godziny pracy, długości okien) i „Kompetencje” (co umiem, w czym chcę rosnąć). Oba pisze Piotr raz, potem poprawia pętla uczenia.
- Pętla uczenia. Dziś agent dostaje zasady i nic nie wraca. Potrzebne są trzy rzeczy: po pierwsze, sygnały, czyli zapis oryginalnego szkicu agenta obok wersji zatwierdzonej (dziś zatwierdzenie tylko zmienia status, różnica ginie), uwagi z czatu oznaczone jako korekta, powody leave_step, wnioski z dziennika; po drugie, tygodniowy bieg „co się powtarza”, który z sygnałów układa propozycje: zmiana istniejącej zasady, nowa procedura, poprawka profilu, każda z dowodami („trzy razy usunąłeś nagłówek w odpowiedzi w wątku”); po trzecie, skrzynka propozycji w Task Hub z przyjęciem jednym dotknięciem i historią, która mówi, co zmienił Piotr, a co pętla. Rodzaje ryzyka są różne, więc proponuję: fakty w profilach (nowy identyfikator, nowy kanał) wchodzą same z powiadomieniem; zasady i procedury czekają na dotknięcie, bo sterują pracą u klientów, a cicha zmiana po tygodniu bywa niewidoczna.

## 4. Integracje: zmiana werdyktu

Wczoraj: połączenia zostają w klientach, Task Hub prowadzi rejestr (C), brama (B) może kiedyś. Dziś, po doprecyzowaniu, cel to B, a C jest pierwszym etapem. Powody:

- Wiele kont jednej aplikacji. Konektory aplikacji Claude są jednym kontem na aplikację; drugi Gmail czy drugi Slack nie wchodzi. Claude Code na Macu pozwala dodać dwa serwery tej samej aplikacji pod różnymi nazwami, ale każdy silnik trzeba konfigurować osobno, a rutyna w chmurze i tak tego nie ma. Jeśli połączenia mają być „moje, wiele, na lata”, muszą leżeć w Task Hub.
- Firmy przychodzą i odchodzą. Połączenie przypięte do firmy gaśnie razem z nią, ale jego etykieta, historia faktów i migawek, zasady i wnioski zostają. Task Hub widzi, że „Slack Pirxey” wygasł, i mówi to zamiast cicho zostawiać kroki.
- Zatwierdzanie w mechanice. Gdy narzędzia przechodzą przez Task Hub, zapis na zewnątrz bez zatwierdzonego szkicu jest blokowany w kodzie, nie w prompcie. Przy wielu firmach i publikacjach na LinkedIn to ważniejsze niż wczoraj.

Co to znaczy dla zasady „kartka papieru” (bez własnych integracji). Proponuję doprecyzowanie, nie odwołanie: Task Hub nie robi integracji per aplikacja (mapowań pól, własnych ekranów Slacka czy ClickUpa), ale może używać protokołów: klient MCP do zdalnych serwerów (Pirxey World, ClickUp, Figma, GitHub, Notion), prywatne adresy iCal dla kalendarzy, w dalszej kolejności IMAP dla poczty. Dane nadal lądują jako fakty i migawki. Pytanie 4 dotyczy tej granicy.

Kolejność:

1. Rejestr połączeń (C): byt „Połączenia” w Ustawieniach, mostek zgłasza przy pulsie listę serwerów MCP Claude Code, wpisy ręczne dla konektorów aplikacji Claude i Pirxey World; każde połączenie ma aplikację, etykietę, konto, firmę, sferę, dostawcę. Krok i szkic wskazują połączenie. Profil w prompcie mówi agentowi, co ma. Około dnia.
2. Kalendarze: połączenia typu iCal (adres prywatny z Google Calendar albo innego kalendarza, zaszyfrowany w bazie), Task Hub pobiera je sam, bez OAuth, dowolna liczba kont, tylko odczyt. To odblokowuje plan dnia. Pół dnia.
3. Klient MCP w Task Hub (B, pierwsza wersja): jedno zdalne połączenie OAuth (Pirxey World albo ClickUp), narzędzia przekazywane agentowi przez /api/mcp z nazwą połączenia, bramka zatwierdzania po adnotacjach narzędzi (zapis tylko ze szkicem). 2 do 3 dni. Potem kolejne serwery tą samą drogą.
4. Poczta w wielu kontach: dopiero gdy będzie potrzebna; droga przez IMAP z hasłem aplikacji albo własnym klientem OAuth Google, z zastrzeżeniem, że klient Google bez weryfikacji ma ograniczenia (tryb testowy z tokenami na 7 dni). Decyzja wtedy.

Pirxey World w tym modelu to jedno połączenie typu MCP, przypięte do firmy Pirxey, dostarczające wiele narzędzi. Po odejściu gaśnie, zasady wypracowane przy nim zostają.

## 5. Nowe byty i pola

- Firma: nazwa, sfera (zawodowa albo prywatna), profil jako zasada rodzaju profil o zakresie firma, data zakończenia współpracy (archiwum).
- Projekt: firma albo brak (prywatny); reszta bez zmian.
- Połączenie: aplikacja, etykieta, konto, firma, sfera, dostawca (konektor Claude, Claude Code na Macu, Pirxey World, Task Hub), stan (działa, wygasło), rodzaj (MCP, iCal, IMAP).
- Dziennik: wpis z transkryptem albo notatką, źródło, data, firma, projekt, uczestnicy, analiza agenta, tagi; oryginał jako załącznik z tą samą polityką co grafiki (tekst zostaje, oryginał według decyzji).
- Wnioski: zdanie wniosku, dowody (wpisy dziennika, zadania, szkice), stan (nowy, przyjęty, użyty w zasadzie, użyty w publikacji).
- Propozycja zmiany zasady: zasada, nowe brzmienie, dowody, stan (czeka, przyjęta, odrzucona); przyjęcie zapisuje wersję z adnotacją „z pętli uczenia”.
- Krok: połączenie (zamiast samej aplikacji), tryb (wykonanie albo analiza i kreacja), oryginalny szkic obok zatwierdzonego.
- Plan dnia: migawka na dany dzień (bloki z zadaniem, oknem czasu, powodem), edytowalna.

## 6. Poranek

Bieg o stałej porze (osobny od rutyny co godzinę, bo robi inne rzeczy): zbiera sygnały ze wszystkich połączeń obu sfer według procedury „Przegląd”; sprawy pewne wpisuje, sprawy na granicy daje jako jedną kartę decyzji z opcjami (zrób, odrzuć, później); czyta wolne okna z wszystkich kalendarzy; bierze profil „Mój rytm”, szacunki, kalibrację i priorytet efektywny; układa plan: okno 90 minut rano dostaje pilny, rozpisany temat; okno 30 minut dostaje krok, który się w nim mieści; okno około 16 dostaje analizę albo kreację; to, co nie weszło, zostaje z powodem. Wynik to widok „Dzień” w Task Hub i jedno powiadomienie. Nic nie wpisuje do kalendarza, dopóki Piotr nie powie, że chce bloków w kalendarzu (pytanie 6).

## 7. Kolejność prac

1. Firmy i sfera, pole pochodzenia zasady, profile „Mój rytm” i „Kompetencje” (treść od Piotra), przeniesienie dwóch wpisów v3 na zakres firmy. Dzień.
2. Rejestr połączeń i wskazanie połączenia w kroku. Dzień.
3. Kalendarze przez iCal i bieg poranny z widokiem „Dzień”. Dwa dni.
4. Dziennik i wnioski, źródła transkryptów według odpowiedzi na pytanie 3. Dwa dni.
5. Pętla uczenia: zapis sygnałów, bieg tygodniowy, skrzynka propozycji. Dwa dni.
6. Klient MCP w Task Hub z bramką zatwierdzania, pierwszy serwer. Trzy dni.
7. Projekt „Obecność” i procedura postów, publikacja z zatwierdzonego szkicu. Pół dnia.

Wgranie zasad v3 nie musi na to czekać: po „zatwierdzam” wgrywam dziś, a zakres firmy dopisuję w punkcie 1 skryptem.

## 8. Pytania

1. Konto Claude piotr.bialobrzeski@pirxey.com: płacisz Ty czy firma? Od tego zależy, czy rutynę i mostek trzeba przenieść na konto prywatne.
2. Samouczenie: zmiany zasad i procedur wchodzą po Twoim jednym dotknięciu (polecam), czy same, z powiadomieniem i możliwością cofnięcia? Fakty w profilach proponuję zawsze same.
3. Transkrypty: skąd dziś pochodzą (Fireflies, Meet, Zoom, nagrania z telefonu) i czy rozmowy z klientami firm wolno Ci trzymać w prywatnej bazie w całości, czy tylko Twoje wnioski bez treści rozmowy? To kwestia NDA, nie techniki.
4. Granica „kartki papieru”: zgadzasz się, że Task Hub może używać protokołów (klient MCP, iCal, później IMAP), a nie może robić mapowań per aplikacja? Polecam tak.
5. Firmy: Pirxey i Widelab jako jedna firma z dwoma brandami (jak w zasadach) czy dwie osobne? Polecam jedną, bo połączenia i tak są per workspace.
6. Plan dnia: tylko propozycja w Task Hub (polecam na start) czy też bloki wpisywane do kalendarza?
