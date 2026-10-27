-- Czego brakuje agentowi do kroku oddanego z braku dostępu (paczka 22): {"kind":"folder","folder":"code"|"files"|"tools","path":"/Users/…"}.
-- Karta kroku pokazuje wtedy „Dodaj folder” (link taskhub://add-folder do aplikacji na Macu). Ważne tylko razem z left_at.
alter table steps add column if not exists need jsonb;
