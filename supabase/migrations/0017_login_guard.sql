-- Ochrona logowania (2026-10-19): każda próba hasła (strona logowania i strona zgody konektora) zapisuje się z IP i przeglądarką,
-- a src/lib/guard.ts liczy nieudane próby i blokuje zgadywanie hasła. To też pierwszy ślad do sprawdzania, kto próbował wejść.
create table if not exists login_events (
  id bigserial primary key,
  at timestamptz not null default now(),
  kind text not null,              -- web | oauth
  ok boolean not null,
  ip text,
  ua text,
  country text,
  note text
);
create index if not exists login_events_at on login_events (at desc);
create index if not exists login_events_ip_at on login_events (ip, at desc);

-- Supabase wystawia schemat public przez swoje REST API (klucz anon). Aplikacja go nie używa, łączy się bezpośrednio jako właściciel tabel,
-- więc włączone RLS bez polityk zamyka tę drogę, a aplikacji nie dotyczy. Pojedynczy błąd nie zatrzymuje wdrożenia.
do $$
declare t record;
begin
  for t in select tablename from pg_tables where schemaname = 'public' loop
    begin
      execute format('alter table public.%I enable row level security', t.tablename);
    exception when others then
      raise notice 'RLS pominięte dla %: %', t.tablename, sqlerrm;
    end;
  end loop;
end $$;
