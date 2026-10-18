-- Karta kroku „Teraz · Co · Skąd”: kiedy krok został zrobiony (nagłówek „Zrobione 12:49”). Stare kroki bez czasu: nagłówek bez godziny.
alter table steps add column if not exists done_at timestamptz;
