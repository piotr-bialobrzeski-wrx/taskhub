# Zasady w Task Hub: czy to dobra architektura? Alternatywy, za i przeciw, werdykt

Odpowiedź na pytanie Piotra z 2026-10-16 wieczorem. Dotyczy formy i mechaniki zasad, nie ich treści merytorycznej (ta jest w dokumencie „Zasady Task Hub v2”).

## Krótka odpowiedź

Kierunek jest dobry: jedno źródło zasad w bazie Task Hub, podawane każdemu agentowi (Claude, GPT, Claude Code, mostek) przez konektor. Słabe jest to, JAK zasady trafiają do agenta: wszystkie naraz, przy każdym kroku, jako proza. Krok „odpisz na Slacku” dostaje dziś także pełną specyfikację user story i buga. To nie jest najlepsza droga na dłużej, ale naprawa jest tania: nie zmiana kierunku, tylko rozdzielenie zasad na trzy rodzaje (profil, zasada, procedura) i dołożenie wyzwalaczy. Szczegóły i werdykt na końcu.

## Jak to działa dziś

Tabela `rules`: zakres (ogólna, projekt, narzędzie), tytuł, treść, kolejność. Przy każdym prompcie (rozłożenie zadania, przekazanie kroku do Claude, złożenie panelu, raport końcowy) oraz w odpowiedzi `get_rules` Task Hub skleja: wszystkie zasady ogólne, zasadę projektu zadania, zasady narzędzi użytych w kroku. Po v2 to około 32 tys. znaków, z czego zasady ogólne (zawsze obecne) to 19 tys., czyli 5-6 tys. tokenów w każdym wywołaniu.

Co w tym jest słabe:

1. **Wszystko, zawsze.** Agent dostaje komplet, a sam musi wybrać, co pasuje do kroku. Długie bloki instrukcji obniżają posłuszeństwo wobec każdej pojedynczej reguły (model „gubi środek”). Koszt tokenów jest drugorzędny (subskrypcja), uwaga modelu nie.
2. **Konfiguracja zmieszana z zachowaniem.** Język dokumentacji projektu, identyfikatory Slacka, id space'a w ClickUpie, profil formatowania to dane, nie zasady. Zapisane w prozie: aplikacja nie może z nich korzystać (np. ustawić języka szkicu, sprawdzić dywizów), a agent musi je za każdym razem wyczytać z tekstu. Projekt w Task Hub ma już pole `language`, więc dziś ta informacja istnieje w dwóch miejscach.
3. **Brak wyzwalaczy.** Jedyny filtr to zakres. Prawdziwy wymiar to rodzaj pracy: przegląd źródeł, odpowiedź w wątku, dokumentacja, kod. Zakres „narzędzie” tylko częściowo go pokrywa.
4. **Brak pętli zwrotnej.** Gdy agent łamie zasadę, poprawiasz go w czacie i to ginie. Nie ma przykładów dobrych wyników, nie ma testu, który sprawdziłby, czy zmiana zasady coś popsuła.
5. **Brak historii.** Edycja nadpisuje; nie wiadomo, jaka wersja zasady obowiązywała, gdy powstał dany szkic.
6. **Dwa źródła prawdy w praktyce.** Standardy w `zasoby/standardy` na Macu zostają dla Claude Code, zasady w Task Hub dla agentów. Mostek pracuje w neutralnym katalogu, więc nie ładuje CLAUDE.md i konfliktu nie ma, ale treści z czasem się rozjadą.

## Alternatywy

### A. Zostawić jak jest (proza w bazie, zakres jako jedyny filtr)

Za: zero kodu, działa z każdym modelem i klientem, Piotr edytuje w UI, przy 24 zasadach mieści się w kontekście.
Przeciw: wszystkie sześć słabości wyżej; każda nowa zasada powiększa blok, który dostaje każdy krok; po 50 zasadach agent przestanie je respektować, a nie będzie widać kiedy.
Kiedy ma sens: na tydzień, do pierwszych obserwacji, jak agent z zasad korzysta.

### B. Trzy rodzaje wiedzy: profil, zasada, procedura (z wyzwalaczami)

Rozdzielić to, co dziś jest jedną tabelą prozy, na trzy rodzaje:

- **Profil** (dane, nie tekst): per projekt i per narzędzie. Język dokumentacji, język z klientem, profil formatowania (nagłówki, listy, kursywa tak/nie, emoji nie), identyfikatory (space ClickUp, workspace'y Slack, id Piotra), podpięte narzędzia. Aplikacja renderuje to w jednym krótkim bloku „PROFIL” i sama z tego korzysta (szkic dostaje język, walidacja formatowania zna profil).
- **Zasada** (krótka, zawsze włączona): ograniczenia zachowania, które obowiązują w każdym kroku. Cel: łącznie 6-8 tys. znaków, nie 19. Z v2 to zasady 1, 3, 4, 10, 11 i skrócona 2.
- **Procedura** (długa, na żądanie): jak zrobić przegląd źródeł i listy (v2: 5, 6), jak napisać user story i buga (7, 8, 9), jak odpisać na Slacku (12), jak napisać prototyp PirxeyOS. Każda ma wyzwalacz: narzędzie kroku, typ dokumentu albo słowo kluczowe w tytule kroku. Agent zawsze widzi listę procedur (nazwa i jedno zdanie, kiedy jej użyć), a treść dostaje tylko ta, która pasuje do kroku; może też poprosić `get_rules(topic)`.

To ten sam mechanizm, co skille w Claude Code (nazwa i opis zawsze, treść po wywołaniu), tylko w bazie i dla każdego klienta.

Za: kontekst kroku spada z 32 do 8-12 tys. znaków i jest w całości na temat; aplikacja korzysta z profilu; nowe zasady nie pogarszają już istniejących; naturalnie mapuje się na v2 (nic nie trzeba pisać od nowa, tylko oznaczyć); działa z każdym modelem.
Przeciw: schemat rośnie (rodzaj, wyzwalacz, dane profilu), trzeba wybrać wyzwalacze mądrze, bo procedura niedołączona to procedura niezastosowana; UI zasad potrzebuje dwóch nowych pól.
Nakład: około jednego dnia pracy wątku (migracja, dwa pola w UI, składanie promptu, `get_rules(topic)`).

### C. Zasady mechaniczne jako kod (walidatory)

Część reguł jest sprawdzalna programem: dywiz zamiast pauzy, puste linie, brak emoji, tytuł zadania do ośmiu słów, obecność sekcji w user story i bugu, język szkicu zgodny z profilem projektu, nazwa „Custom Cookies” w jednej formie. Task Hub sprawdza wynik przy `set_blocks` i `complete_step`; naruszenia wracają do agenta jako lista do poprawy, zanim szkic trafi do Ciebie.

Za: niezawodność tam, gdzie model bywa niechlujny (pauzy, puste linie); zasady mechaniczne znikają z promptu, bo i tak zostaną wyegzekwowane; da się mierzyć, które reguły agent łamie najczęściej.
Przeciw: kod na każdą regułę (choć proste, 10-20 linii każda); obejmuje może jedną trzecią zasad, reszta to osąd; fałszywe alarmy irytują, więc walidator ma prawo tylko zgłaszać, nie blokować.
Nakład: pół dnia na pierwsze 6-8 walidatorów.

### D. Przykłady zamiast opisów (wzorcowe wyniki)

Przy każdej procedurze trzymać jeden lub dwa wzorcowe wyniki: dobra user story, dobry bug, dobra odpowiedź w wątku, dobrze rozpisane zadanie. Model dostaje przykład obok procedury. Źródłem mogłyby być Twoje zatwierdzone szkice: przycisk „to jest wzór” przy zatwierdzaniu.

Za: modele naśladują przykłady lepiej, niż stosują abstrakcyjne reguły; przykład jest krótszy niż opis wszystkich warunków; Ty zatwierdzasz obrazem, nie definicją; zbiór rośnie sam z pracy.
Przeciw: ryzyko przenoszenia treści między klientami (przykład z Shiftwow w story dla Custom Cookies), więc przykłady muszą być per projekt albo odpersonalizowane; model potrafi skopiować przykład zbyt dosłownie; nie zastąpi reguł o kwalifikacji zadań (co jest sprawą Piotra), bo to logika, nie styl.
Nakład: mały (pole „przykład” przy procedurze, przycisk przy szkicu), ale wymaga kuracji.

### E. Wyszukiwanie zasad wektorami (RAG, pgvector)

Każda zasada jako wektor; przy kroku pobierane są najbardziej podobne do celu kroku.

Za: skaluje się do setek zasad bez ręcznego tagowania; pgvector już jest w bazie.
Przeciw: przy 24 zasadach to armata na wróbla; pominięta zasada to zasada cicho niezastosowana, a przy wyszukiwaniu podobieństwem nie widać, że coś pominięto; embeddingi wymagają klucza API i opłat, których nie chcesz; wynik zależy od sformułowania celu kroku.
Kiedy ma sens: gdy zasad będzie ponad sto i będą pisane przez wiele osób. Nie teraz.

### F. Pliki jako źródło prawdy (git), baza jako kopia

Zasady żyją w repo (jak dziś w `zasoby/standardy`), Task Hub je importuje.

Za: historia i diff za darmo, review zmian, te same pliki dla Claude Code na Macu, którego już masz.
Przeciw: sprzeczne z Twoją decyzją z 15.10 (baza jest masterem), edycja wymaga gita zamiast UI, agent w chmurze nie widzi plików z Maca, a synchronizacja w dwie strony to pewne kłopoty.
Wariant do rozważenia: baza masterem, z historią wersji w tabeli, plus eksport jednokierunkowy do plików na Macu dla Claude Code. Albo prościej: Claude Code bierze zasady z konektora (`get_rules`), który już ma.

### G. Inne architektury agenta (poza zasadami)

- **Jeden agent generalista z kompletem zasad** (dziś). Prosty, ale patrz słabości.
- **Role według momentu pracy**: Przeglądacz, Pisarz dokumentacji, Odpowiadacz, Koder; rola to nazwany pakiet: profil, zasady, procedury, dozwolone narzędzia. Krok wybiera rolę po narzędziu i typie. To w praktyce wariant B z nazwą; daje też bezpieczeństwo (Odpowiadacz nie ma prawa pisać w ClickUpie).
- **Orkiestrator i podagenci** (jeden rozdziela, inni wykonują równolegle). Przy wykonaniu na subskrypcji każdy podagent to osobna sesja; dla jednej osoby i kilkunastu zadań dziennie to złożoność bez zysku. Nie teraz.

## Werdykt

Obecna droga (zasady w bazie, podawane przez konektor) jest właściwa i nie zmieniałbym jej. Zmieniłbym sposób podawania: **B jako rdzeń, C i D jako dodatki, w tej kolejności**. E i F odrzucam na teraz z powodów wyżej. G w wersji „role” to etykieta na B, warto ją wprowadzić, gdy pojawi się potrzeba ograniczania uprawnień per rodzaj kroku.

Dlaczego B: rozwiązuje cztery z sześciu słabości (wszystko zawsze, konfiguracja w prozie, brak wyzwalaczy, rozrost) jedną zmianą, bez nowej zależności, bez kosztów i bez zmiany tego, co napisaliśmy w v2. C dokłada niezawodność tam, gdzie model jest słaby, a D dokłada pętlę zwrotną, której dziś nie ma. Historia wersji (słabość 5) to jedna tabela `rule_versions`, można dołożyć przy okazji B.

Jak wyglądałby wtedy jeden krok, na przykład „Odpowiedz Kindze w wątku #shiftwow-ba”:

1. Task Hub składa prompt: profil projektu Shiftwow (język en, ClickUp, Figma) i profil Slacka (workspace, id Piotra) w ok. 600 znakach; zasady zawsze włączone w ok. 7 tys.; procedura „Odpowiedź w wątku” w ok. 900 znakach, bo wyzwala ją narzędzie slack. Razem ok. 9 tys. znaków zamiast 32 tys., wszystko na temat.
2. Agent pisze szkic i zapisuje go przez `set_blocks`.
3. Walidatory sprawdzają dywizy, puste linie, emoji i język; ewentualne uwagi wracają do agenta, który poprawia.
4. Ty zatwierdzasz; jeśli szkic jest wzorcowy, jednym kliknięciem staje się przykładem dla tej procedury w tym projekcie.

Co to znaczy dla zasad v2 (żeby nie pisać ich trzeci raz):

| Zasady v2 | Rodzaj po zmianie |
| --- | --- |
| 1 Rozmowa i treści na zewnątrz, 3 Co jest zadaniem, 4 Jak wygląda zadanie, 10 Jak pracujesz, 11 Firma | zasady zawsze włączone (po lekkim skróceniu ok. 7 tys. znaków) |
| 2 Formatowanie | zasada (część o znaczeniu formatowania) + profil (dozwolone elementy) + walidatory (puste linie, emoji, dywiz) |
| 5 Przegląd źródeł, 6 Przegląd listy | jedna procedura „Przegląd”, wyzwalacz: przegląd z rutyny i list_work |
| 7, 8, 9 Dokumentacja | procedury „User story”, „Bug”, „Dokument” z częścią wspólną; wyzwalacz: narzędzie clickup i typ dokumentu w tytule kroku |
| 12-17 narzędzia | profil narzędzia (identyfikatory, format) + krótka procedura, gdy jest (Slack: formatowanie przez MCP) |
| 18-24 projekty | profil projektu (język, waga, integracje, ścieżki na Macu) + zasady projektu tylko tam, gdzie zostaje osąd (np. Custom Cookies: F i D jako ustalone, reszta do potwierdzenia) |

## Co proponuję zrobić teraz

1. Zatwierdzasz treść v2 merytorycznie (to, co już przeczytałeś; zmiana rodzaju nie zmienia treści).
2. Zanim wgram zasady, robię B w Task Hub: rodzaj (profil, zasada, procedura), wyzwalacz, profil projektu i narzędzia jako dane, składanie promptu po nowemu, `get_rules(topic)`, historia wersji. Około jednego dnia wątku. Wgrywam zasady od razu w nowym układzie, żeby nie przekładać ich dwa razy.
3. Po tygodniu pracy agenta: pierwsze walidatory (C) dla tego, co agent łamie najczęściej, i przycisk „to jest wzór” (D).

Jeśli wolisz mieć zasady w Task Hub od razu, mogę wgrać v2 w obecnym układzie dziś, a B zrobić później; wtedy przełożenie na rodzaje zrobię skryptem, bez ręcznej pracy, więc koszt zwłoki jest mały. Rekomenduję jednak kolejność wyżej.
