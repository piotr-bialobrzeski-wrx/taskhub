-- Task Hub: schemat bazy (Postgres 15+). Zasada: brak schematów per aplikacja.
-- Zewnętrzne dane trafiają do faktów (facts) z pochodzeniem i do migawek (snapshots) w całości.

create extension if not exists pgcrypto;

-- ---------- użytkownicy ----------
create table if not exists users (
  id          uuid primary key default gen_random_uuid(),
  email       text not null unique,
  name        text,
  settings    jsonb not null default '{}'::jsonb,   -- np. {"ai_provider":"anthropic"}
  created_at  timestamptz not null default now()
);

-- tokeny dla klientów MCP (Claude Code, ChatGPT, własny agent); trzymamy tylko skrót
create table if not exists api_tokens (
  id           uuid primary key default gen_random_uuid(),
  owner_id     uuid not null references users(id) on delete cascade,
  name         text not null,
  token_hash   text not null unique,
  created_at   timestamptz not null default now(),
  last_used_at timestamptz
);

-- ---------- projekty ----------
create table if not exists projects (
  id          uuid primary key default gen_random_uuid(),
  owner_id    uuid not null references users(id) on delete cascade,
  name        text not null,
  color       int  not null default 0,
  weight      int  not null default 3 check (weight between 1 and 5),  -- ważność projektu
  language    text not null default 'pl',
  created_at  timestamptz not null default now(),
  archived_at timestamptz
);
create index if not exists projects_owner on projects(owner_id);

-- ---------- zadania ----------
create table if not exists tasks (
  id           uuid primary key default gen_random_uuid(),
  owner_id     uuid not null references users(id) on delete cascade,
  project_id   uuid references projects(id) on delete set null,
  title        text not null,
  summary      text not null default '',
  source       text not null default '',     -- "jak wpadło": wklejona wiadomość, notatka
  level        int  not null default 3 check (level between 1 and 5),
  due          date,
  done_at      timestamptz,
  deleted_at   timestamptz,                  -- kosz
  note_text    text,                         -- notatka końcowa dla agentów
  note_summary text,                         -- podsumowanie dla człowieka
  note_at      timestamptz,
  pos          jsonb,                        -- pozycja na kanwie {x,y}
  search       tsvector generated always as (
                 to_tsvector('simple', coalesce(title,'') || ' ' || coalesce(summary,'') || ' ' || coalesce(source,'') || ' ' || coalesce(note_text,''))
               ) stored,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index if not exists tasks_owner_board on tasks(owner_id) where deleted_at is null;
create index if not exists tasks_project on tasks(project_id);
create index if not exists tasks_search on tasks using gin(search);

create table if not exists task_dependencies (
  task_id       uuid not null references tasks(id) on delete cascade,
  depends_on_id uuid not null references tasks(id) on delete cascade,
  primary key (task_id, depends_on_id),
  check (task_id <> depends_on_id)
);

-- ---------- kroki ----------
create table if not exists steps (
  id             uuid primary key default gen_random_uuid(),
  task_id        uuid not null references tasks(id) on delete cascade,
  position       int  not null default 0,
  title          text not null,
  detail         text not null default '',
  tool           text not null default 'manual',   -- gdzie ląduje krok: slack, clickup, gmail, calendar, claude, claudeapp, code, manual, browser, ... (wolny tekst)
  status         text not null default 'todo' check (status in ('todo','draft','done','handoff')),
  prev_status    text,
  needs_approval boolean not null default false,
  est_min        int  not null default 15 check (est_min >= 15),
  spent_sec      int  not null default 0,
  spent_manual   boolean not null default false,
  spent_at       timestamptz,
  link           text,                              -- adres kroku w zewnętrznej aplikacji
  handoff_at     timestamptz,
  report         text,                              -- raport wklejony po pracy w Claude
  output         text not null default '',          -- szkic / wynik
  review         jsonb,                             -- odbiór raportu przez agenta
  blocks         jsonb,                             -- układ bloków złożony przez agenta
  blocks_at      timestamptz,
  logged         boolean not null default false,    -- czas zapisany do time_samples
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index if not exists steps_task on steps(task_id, position);

create table if not exists step_dependencies (
  step_id       uuid not null references steps(id) on delete cascade,
  depends_on_id uuid not null references steps(id) on delete cascade,
  primary key (step_id, depends_on_id),
  check (step_id <> depends_on_id)
);

-- ---------- fakty: to, co agent uznał za istotne, z pochodzeniem ----------
create table if not exists facts (
  id          uuid primary key default gen_random_uuid(),
  task_id     uuid references tasks(id) on delete cascade,
  step_id     uuid references steps(id) on delete cascade,
  label       text not null,
  value       text not null,
  source_app  text,            -- 'clickup', 'slack', 'gmail', ...
  source_ref  text,            -- np. nazwa pola w ClickUp
  source_url  text,
  fetched_at  timestamptz,
  pinned      boolean not null default false,   -- Piotr: zawsze pokazuj
  hidden      boolean not null default false,   -- Piotr: nie pokazuj
  position    int  not null default 0,
  created_at  timestamptz not null default now(),
  check (task_id is not null or step_id is not null)
);
create index if not exists facts_step on facts(step_id);
create index if not exists facts_task on facts(task_id);

-- ---------- migawki: oryginał z zewnętrznej aplikacji w całości ----------
create table if not exists snapshots (
  id          uuid primary key default gen_random_uuid(),
  task_id     uuid references tasks(id) on delete cascade,
  step_id     uuid references steps(id) on delete cascade,
  source_app  text not null,
  source_id   text,
  url         text,
  raw         jsonb not null,
  fetched_at  timestamptz not null default now(),
  check (task_id is not null or step_id is not null)
);
create index if not exists snapshots_step on snapshots(step_id, fetched_at desc);
create index if not exists snapshots_task on snapshots(task_id, fetched_at desc);

-- ---------- załączniki: grafiki, pliki, linki do plików ----------
create table if not exists attachments (
  id           uuid primary key default gen_random_uuid(),
  task_id      uuid references tasks(id) on delete cascade,
  step_id      uuid references steps(id) on delete cascade,
  kind         text not null check (kind in ('image','file','link')),
  name         text,
  url          text,              -- link zewnętrzny albo publiczny adres pliku
  storage_path text,              -- ścieżka w Supabase Storage
  mime         text,
  bytes        int,
  caption      text,
  analysis     text,              -- opis agenta: co jest na grafice, tekst, liczby, wnioski
  keep         boolean not null default false,
  added_at     timestamptz not null default now(),
  expires_at   timestamptz,       -- oryginał tymczasowy znika po tej dacie, analiza zostaje
  check (task_id is not null or step_id is not null)
);
create index if not exists attachments_task on attachments(task_id);
create index if not exists attachments_step on attachments(step_id);

-- ---------- zasady: jak pracować (styl, język, gdzie szukać) ----------
create table if not exists rules (
  id          uuid primary key default gen_random_uuid(),
  owner_id    uuid not null references users(id) on delete cascade,
  scope       text not null check (scope in ('global','project','tool')),
  project_id  uuid references projects(id) on delete cascade,
  tool        text,
  title       text not null,
  body        text not null,
  visibility  text not null default 'private' check (visibility in ('private','project','shared')),
  position    int  not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  check (scope <> 'project' or project_id is not null),
  check (scope <> 'tool' or tool is not null)
);
create index if not exists rules_owner on rules(owner_id, scope);

-- ---------- uczenie się z czasów ----------
create table if not exists time_samples (
  id          uuid primary key default gen_random_uuid(),
  owner_id    uuid not null references users(id) on delete cascade,
  step_id     uuid references steps(id) on delete set null,
  tool        text not null,
  project_id  uuid references projects(id) on delete set null,
  est_min     int not null,
  spent_min   int not null,
  at          timestamptz not null default now()
);
create index if not exists time_samples_owner on time_samples(owner_id, tool, at desc);

-- ---------- czat z agentem (na głównej kanwie i w każdym zadaniu) ----------
create table if not exists chat_messages (
  id          uuid primary key default gen_random_uuid(),
  owner_id    uuid not null references users(id) on delete cascade,
  task_id     uuid references tasks(id) on delete cascade,   -- null = główna kanwa
  role        text not null check (role in ('user','agent')),
  text        text not null,
  actions     jsonb,
  created_at  timestamptz not null default now()
);
create index if not exists chat_owner_task on chat_messages(owner_id, task_id, created_at);

-- ---------- grupy na kanwie ----------
create table if not exists canvas_groups (
  id          uuid primary key default gen_random_uuid(),
  owner_id    uuid not null references users(id) on delete cascade,
  task_id     uuid references tasks(id) on delete cascade,   -- null = główna kanwa
  name        text not null,
  color       int not null default 0,
  x int not null, y int not null, w int not null, h int not null,
  members     uuid[] not null default '{}',
  auto        boolean not null default false,
  created_at  timestamptz not null default now()
);
create index if not exists groups_owner_task on canvas_groups(owner_id, task_id);

-- ---------- konektory użytkownika (serwery MCP) ----------
create table if not exists connectors (
  id          uuid primary key default gen_random_uuid(),
  owner_id    uuid not null references users(id) on delete cascade,
  app         text not null,            -- 'clickup', 'slack', ...
  name        text not null,
  url         text not null,
  auth        jsonb not null default '{}'::jsonb,   -- zaszyfrowane po stronie aplikacji
  enabled     boolean not null default true,
  created_at  timestamptz not null default now()
);
create index if not exists connectors_owner on connectors(owner_id);

-- ---------- pamięć układu: jak agent ostatnio ułożył bloki dla danego źródła ----------
create table if not exists layout_memory (
  owner_id    uuid not null references users(id) on delete cascade,
  source_app  text not null,
  kind        text not null default 'step',
  blocks      jsonb not null,
  updated_at  timestamptz not null default now(),
  primary key (owner_id, source_app, kind)
);

-- ---------- updated_at ----------
create or replace function set_updated_at() returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end $$;

do $$ begin
  if not exists (select 1 from pg_trigger where tgname = 'tasks_updated_at') then
    create trigger tasks_updated_at before update on tasks for each row execute function set_updated_at();
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'steps_updated_at') then
    create trigger steps_updated_at before update on steps for each row execute function set_updated_at();
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'rules_updated_at') then
    create trigger rules_updated_at before update on rules for each row execute function set_updated_at();
  end if;
end $$;
