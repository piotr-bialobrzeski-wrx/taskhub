-- Aplikacja na Maca 0.1.17 zgłosiła serwer „clickup” z folderu z narzędziami, który przez tę samą etykietę nadpisał wpis
-- konektora z Claude („claude.ai ClickUp”): nazwa serwera w meta zmieniła się na „clickup”, stan na „expired”. To samo z Figmą.
-- Poprawka 10520c7 naprawia to przy następnym zgłoszeniu mostka; ta migracja przywraca takie wpisy od razu.
-- Wpis z Claude ma nazwę serwera „claude.ai <etykieta>”; jego stan ostatnio potwierdziła próba mostka (connected).
update connections
set meta = meta || jsonb_build_object('server', 'claude.ai ' || label, 'status', 'Connected'),
    state = 'active', updated_at = now()
where source = 'bridge' and provider = 'claude'
  and coalesce(meta->>'server', '') !~* '^claude\.ai\s'
  and state = 'expired';
