-- Kanwa kroków: położenie kafelka kroku. Pytania agenta do Piotra zadawane w aplikacji (nie w czacie Claude).
alter table steps add column if not exists pos jsonb;   -- {x,y} na kanwie zadania

create table if not exists questions (
  id          uuid primary key default gen_random_uuid(),
  owner_id    uuid not null references users(id) on delete cascade,
  task_id     uuid not null references tasks(id) on delete cascade,
  step_id     uuid references steps(id) on delete cascade,
  text        text not null,
  options     jsonb not null default '[]',     -- [{label, note}]
  recommended int,
  answer      text,
  asked_by    text not null default 'agent',
  asked_at    timestamptz not null default now(),
  answered_at timestamptz,
  seen_at     timestamptz                       -- agent odczytał odpowiedź
);
create index if not exists questions_owner_open on questions(owner_id, answered_at, seen_at);
