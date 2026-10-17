-- Rejestr połączeń (etap 2 wizji, 2026-10-17): Task Hub wie, do jakich aplikacji agent ma dostęp, przez co (Claude, Claude Code
-- na komputerze, sam Task Hub), na jakim koncie i dla której firmy. Połączenie to rura, nie klucz: żadnych tokenów cudzych usług tutaj.
-- Mostek zgłasza swoją listę konektorów (source = 'bridge'), ręczne wpisy opisują resztę (source = 'manual').
-- Po odejściu z firmy wiadomo, co zniknie, a nowy silnik dostaje gotową konfigurację.
create table if not exists connections (
  id          uuid primary key default gen_random_uuid(),
  owner_id    uuid not null references users(id) on delete cascade,
  app         text not null,                                   -- slack, gmail, clickup, calendar, figma, github, ... (klucz jak w narzędziach kroków)
  label       text not null,                                   -- nazwa jak w konektorze: "slack", "Slack Pirxey"
  account     text,                                            -- konto po stronie usługi: adres e-mail, workspace; bez sekretów
  company_id  uuid references companies(id) on delete set null,
  sphere      text not null default 'work' check (sphere in ('work','private')),
  provider    text not null default 'claude' check (provider in ('claude','claude-code','taskhub')),
  kind        text not null default 'mcp' check (kind in ('app','mcp','ical','imap')),
  state       text not null default 'active' check (state in ('active','expired','off')),
  source      text not null default 'manual' check (source in ('manual','bridge')),
  host        text,                                            -- komputer, który zgłosił (source = 'bridge')
  url         text,                                            -- adres serwera MCP albo kalendarza; bez tokenów w adresie
  meta        jsonb not null default '{}'::jsonb,
  seen_at     timestamptz,                                     -- ostatnie potwierdzenie, że działa
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists connections_owner on connections(owner_id);
-- mostek nadpisuje własne wpisy po (właściciel, komputer, nazwa)
create unique index if not exists connections_bridge_key on connections(owner_id, host, lower(label)) where source = 'bridge';

-- krok może wskazać, przez które połączenie ma być zrobiony (np. Slack firmy X, nie prywatny)
alter table steps add column if not exists connection_id uuid references connections(id) on delete set null;
