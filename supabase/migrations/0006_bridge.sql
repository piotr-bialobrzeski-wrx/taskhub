-- Mostek na komputerze (jak w Project Hub): program na Macu odpytuje Task Hub bez tokenów i uruchamia Claude Code tylko do realnej pracy.
-- Token rodzaju "bridge" niesie puls mostka; biegi pracy są rejestrowane, żeby dwa komputery nie robiły tego samego.
alter table api_tokens add column if not exists kind    text not null default 'client';   -- client | bridge
alter table api_tokens add column if not exists seen_at timestamptz;                      -- ostatni sygnał mostka
alter table api_tokens add column if not exists meta    jsonb not null default '{}';      -- mostek: {host, runner, version, note}

create table if not exists bridge_runs (
  id         uuid primary key default gen_random_uuid(),
  owner_id   uuid not null references users(id) on delete cascade,
  token_id   uuid references api_tokens(id) on delete set null,
  bridge     text not null,                       -- nazwa komputera
  started_at timestamptz not null default now(),
  touched_at timestamptz not null default now(),  -- ostatni sygnał z biegu (postęp)
  ended_at   timestamptz,
  outcome    text,                                -- done | error | limit | auth | stale
  note       text                                 -- ostatni krok albo powód
);
create index if not exists bridge_runs_owner_time on bridge_runs(owner_id, started_at desc);
-- jeden otwarty bieg na właściciela: wstawienie drugiego kończy się konfliktem, więc dwa mostki nie ruszą naraz
create unique index if not exists bridge_runs_one_open on bridge_runs(owner_id) where ended_at is null;
