-- Paczka 55: czas Claude'a w kroku liczony od startu próby albo od ostatniego zamknięcia kroku w tej próbie (decyzja w zadaniu „Weryfikuj czas pracy agenta”).
-- close_at: ostatnie zamknięcie (albo oddanie) kroku w biegu mostka; od niego liczy się czas następnego kroku, więc kroki z jednej próby się nie dublują.
alter table bridge_runs add column if not exists close_at timestamptz;
-- Sesja w chmurze nie ma biegu: ostatnie zamknięcie kroku wziętego w chmurze; kroki wzięte w jednej sesji dzielą czas sesji.
alter table users add column if not exists cloud_close_at timestamptz;
