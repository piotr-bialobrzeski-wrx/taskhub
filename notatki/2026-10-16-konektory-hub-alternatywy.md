# Czy Task Hub powinien mieć własne konektory MCP

Data: 2026-10-16. Pytanie Piotra: jeśli Task Hub ma być hubem, pod który podpina się dowolnego agenta (Claude w chmurze, GPT, agent lokalny), to czy konektory do Slacka, ClickUpa, Gmaila i reszty nie powinny należeć do Task Hub zamiast do Claude Code? Bo po odejściu z firmy Claude Code z jego konektorami zniknie razem z dostępami.

## Krótka odpowiedź

W połowie dobrze. Dobrze: hub nie może zależeć od jednego klienta, więc to, co agent wie i czego się nauczył, musi żyć w Task Hub, a podpięcie nowego silnika ma trwać minuty, nie dni. Źle: własne konektory nie uratują dostępów firmowych. Dostęp do Slacka Pirxey, ClickUpa klienta czy skrzynki piotr.bialobrzeski@pirxey.com daje firma, przez Twoje konto w tych aplikacjach. Po odejściu konto gaśnie i każdy token, obojętnie czy trzyma go Claude Code, Task Hub czy cokolwiek innego, przestaje działać tego samego dnia. Konektor to rura, nie klucz.

To, co naprawdę zostaje po odejściu, to dane w Task Hub: zadania, kroki, fakty, migawki, szkice, archiwum, zasady. Dlatego zasada „kartka papieru” (agent zapisuje w Task Hub fakty i migawki z tego, co przeczytał) chroni Cię lepiej niż jakikolwiek konektor: za rok nie będziesz miał Slacka Pirxey, ale będziesz miał to, co z niego wynikało.

## Co dziś zależy od czego

| Element | Gdzie żyje | Co się z nim dzieje po odejściu z firmy |
| --- | --- | --- |
| Task Hub (aplikacja, baza, zasady, historia) | Vercel i Supabase na Twoim prywatnym koncie, repo z aliasem prywatnym | zostaje |
| Aplikacja na Maca i mostek | plik .pkg z GitHub Releases, instalacja na dowolnym Macu w 5 minut | zostaje; na nowym Macu logujesz Claude Code i wklejasz token mostka |
| Silnik agenta (subskrypcja Claude) | konto Claude na adresie piotr.bialobrzeski@pirxey.com | jeśli płaci firma: znika razem z tym projektem, rutyną co godzinę, notatkami w plikach projektu, pamięcią i konektorami projektu |
| Konektory w Claude Code na Macu i w tym projekcie (Slack, ClickUp, Gmail, kalendarz, Drive, Figma) | logowania na Twoje konta firmowe | gasną z kontami firmowymi, niezależnie od tego, kto je trzyma |
| Skille firmowe i repo world | własność firmy | zostają w firmie |
| Konta prywatne (Gmail prywatny, własne workspace'y, GitHub prywatny) | Twoje | zostają, ale dziś nie są nigdzie podpięte |

Najważniejsza rzecz do sprawdzenia: czy subskrypcja Claude, na której działa ten projekt i mostek, jest Twoja prywatna, czy firmowa. Jeśli firmowa, to ryzyko jest większe niż konektory: razem z kontem znika ten projekt z notatkami, rutyna i autoryzacja konektora Task Hub. Zasady już są bezpieczne, bo lądują w bazie Task Hub.

## Alternatywy

### A. Zostawić jak jest: konektory w kliencie, Task Hub czystą kartką

Agent (Claude Code przez mostek, Claude w chmurze przez rutynę, w przyszłości Codex albo GPT) ma własne konektory i rozmawia z Task Hub jednym konektorem.

Za: zero kodu integracji w Task Hub; logowania obsługuje dostawca klienta; żadnych sekretów cudzych aplikacji w Task Hub (włamanie do Task Hub to wyciek zadań, nie poczty); każdy nowy silnik z obsługą MCP działa od razu; zgodne z zasadą „kartka papieru”.
Przeciw: Task Hub nie wie, co agent potrafi, więc nie umie powiedzieć „ten krok zrobi mostek, tamtego nikt” ani ostrzec, że Figma nie jest podpięta; dwa silniki to dwie konfiguracje do pilnowania; nowy Mac albo nowy silnik to ręczne klikanie konektorów od zera; zakaz wysyłki bez zatwierdzenia jest tylko w prompcie, nie w mechanice.

### B. Task Hub jako brama MCP: konektory i logowania w Task Hub

Task Hub trzyma listę zdalnych serwerów MCP (Slack, ClickUp, GitHub, Figma, Notion…), loguje się do nich przez OAuth jako klient MCP, trzyma zaszyfrowane tokeny i udostępnia ich narzędzia agentowi przez swój jeden endpoint /api/mcp (np. slack_send_message jako narzędzie Task Hub). Agent, obojętnie który, podpina tylko Task Hub i ma wszystko.

Za: jeden zestaw połączeń dla każdego silnika, zamiana Claude na GPT bez konfiguracji; Task Hub zna swoje możliwości i planuje kroki pod nie; zatwierdzanie da się wymusić w kodzie, nie w prompcie (narzędzie oznaczone jako zapis przechodzi tylko z zatwierdzonym szkicem; MCP ma do tego adnotacje readOnlyHint i destructiveHint); pełny dziennik działań na zewnątrz w jednym miejscu; nadal bez własnych integracji per aplikacja, bo narzędzia przechodzą z serwerów dostawców bez mapowania pól.
Przeciw: Task Hub staje się sejfem na tokeny do poczty i Slacka, czyli celem wartym włamania; klient MCP z OAuth, odświeżaniem tokenów, przekazywaniem narzędzi i ich adnotacji to 2 do 3 dni pracy plus utrzymanie; działa tylko tam, gdzie dostawca ma oficjalny zdalny serwer MCP (GitHub, ClickUp, Figma, Notion tak; Google, o ile wiem, nie, więc Gmail, kalendarz i Drive wymagałyby własnego klienta OAuth Google albo serwera postawionego na Macu); w firmowych workspace'ach własna aplikacja OAuth może wymagać zgody administratora, której konektory Anthropica już mają; każde narzędzie przechodzące przez Task Hub to większy kontekst agenta; i wreszcie: nie rozwiązuje problemu, od którego zaczęliśmy, bo tokeny firmowe i tak zgasną.

### C. Rejestr i eksport: połączenia zostają w klientach, Task Hub wie o nich i umie je odtworzyć

Task Hub prowadzi rejestr silników i ich konektorów: mostek przy każdym pulsie zgłasza, jakie serwery MCP ma Claude Code na tym Macu; rutyna w chmurze zgłasza swoje; wpis ręczny dla reszty. Rejestr jest widoczny w Ustawieniach → Połączenia i trafia do profilu w prompcie agenta („masz: Slack, ClickUp, Gmail; nie masz: Figma”). Do tego eksport: Task Hub generuje z rejestru gotową konfigurację dla nowego silnika (polecenia claude mcp add dla Claude Code, plik config dla Codexa), więc nowy Mac albo nowy silnik ustawiasz w minuty.

Za: tanie (dzień pracy), bez sekretów w Task Hub, rozwiązuje „Task Hub nie wie, co potrafi” i „nowy silnik od zera”; krok, którego nikt nie zrobi, dostaje leave_step z nazwą brakującego konektora zamiast cichej porażki; zgodne z kartką papieru.
Przeciw: połączenia nadal nie są własnością Task Hub; zatwierdzanie dalej pilnuje prompt; rejestr może się rozjechać z rzeczywistością, jeśli ktoś zmieni konfigurację poza mostkiem (dlatego mostek ma ją zgłaszać sam).

### D. Własny silnik agenta w Task Hub (klucze API, pętla narzędzi po stronie serwera)

Task Hub sam prowadzi rozmowę z modelem przez API i sam wywołuje narzędzia MCP.

Za: pełna niezależność od jakiegokolwiek klienta czatu; zamiana modelu to jedna linia; zatwierdzanie w kodzie.
Przeciw: płacenie za tokeny, co odrzuciłeś; budowa całej pętli agenta, której Claude Code i Codex już mają; utrata skilli i narzędzi Claude Code; sekrety jak w B. Nie teraz.

### E. Jeden lokalny hub MCP na Macu dla wszystkich silników

Zamiast konfigurować konektory osobno w Claude Code i w Codexie, jedna lokalna konfiguracja (agregator MCP albo wspólny plik), z której korzysta każdy silnik na tym Macu.

Za: jedna konfiguracja lokalnie, bez sekretów w chmurze, konta prywatne podpinasz tak samo.
Przeciw: działa tylko, gdy Mac nie śpi (jak mostek); rutyna w chmurze nadal potrzebuje własnych konektorów; to wariant techniczny C, nie osobna droga.

## Werdykt

Najlepsza droga: **C teraz, B tylko dla kont prywatnych i dopiero wtedy, gdy będą potrzebne, D nigdy w obecnym modelu kosztów**.

Uzasadnienie. Twoje dwa prawdziwe cele to: po pierwsze, żeby po odejściu z firmy nie stracić tego, co zbudowałeś; po drugie, żeby podpięcie innego agenta było proste. Pierwszy cel realizują już dane w Task Hub i prywatne konta na Vercelu, Supabase i w repo; luka jest w subskrypcji Claude i w notatkach tego projektu, nie w konektorach. Drugi cel realizuje C za dzień pracy, bo przy MCP „podpiąć agenta” znaczy „dać mu listę serwerów”, a tę listę Task Hub może trzymać i wydawać. B dałby więcej (wymuszone zatwierdzanie, jeden endpoint), ale za cenę sejfu na tokeny i kilku dni pracy, i to dla narzędzi, które po odejściu z firmy i tak zgasną. Ma sens dopiero dla kont prywatnych, i to wyłącznie przez oficjalne zdalne serwery MCP dostawców, bez własnych integracji.

## Co proponuję zrobić

1. Teraz, Twoja decyzja: sprawdź, kto płaci za konto Claude piotr.bialobrzeski@pirxey.com. Jeśli firma: załóż prywatne konto Claude, podepnij w nim konektor Task Hub, odtwórz tam rutynę i zaloguj Claude Code na Macu na to konto; notatki z plików tego projektu skopiuję do repo Task Hub (katalog notatki/), żeby nie zniknęły z kontem.
2. Teraz, ja: rejestr połączeń (C). Mostek zgłasza przy pulsie listę serwerów MCP swojego Claude Code; Ustawienia → Połączenia pokazują, co ma mostek, a co rutyna; profil w prompcie mówi agentowi, czym dysponuje; eksport konfiguracji dla Claude Code i Codexa. Około dnia pracy, bez nowych sekretów.
3. Później, gdy pojawi się pierwszy silnik bez własnych konektorów albo pierwsze konto prywatne do podpięcia: B w wersji minimalnej dla jednego serwera (GitHub albo ClickUp), z bramką zatwierdzania po adnotacjach narzędzi. Decyzja wtedy, nie dziś.
