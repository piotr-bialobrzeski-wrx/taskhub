-- Krok oddany przez agenta, bo nie dał rady (paczka 18, ramki i etykiety kafelka): left_at = kiedy. Kafelek pokazuje wtedy „Potrzebna pomoc”.
-- Oddanie z czekania (na inny krok, na chmurę) go nie ustawia; każda zmiana stanu kroku, start agenta albo zlecenie do chmury go czyści.
alter table steps add column if not exists left_at timestamptz;
