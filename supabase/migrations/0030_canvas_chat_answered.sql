-- Paczka 29: wiadomość z głównej kanwy bez odpowiedzi to teraz praca dla agenta (polecenie albo nowe zadanie).
-- Dotąd każda taka wiadomość od razu stawała się zadaniem, a jej wpis w rozmowie kanwy zostawał bez odpowiedzi:
-- dawne wpisy zamykamy, żeby agent nie zrobił ich drugi raz.
update chat_messages set seen_at = coalesce(seen_at, now()), answered_at = now()
  where task_id is null and role = 'user' and answered_at is null;
