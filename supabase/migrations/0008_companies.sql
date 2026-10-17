-- Firmy nad projektami (decyzja Piotra 2026-10-17): Task Hub zostaje z nim na lata, przy kilku firmach naraz.
-- Firma ma sferę (zawodowa albo prywatna); projekt należy do firmy albo jest prywatny; zasada może mieć zakres „firma”;
-- każda zasada niesie pochodzenie (moja albo wypracowana w firmie X), żeby dało się ją kiedyś wyeksportować firmie.
create table if not exists companies (
  id          uuid primary key default gen_random_uuid(),
  owner_id    uuid not null references users(id) on delete cascade,
  name        text not null,
  sphere      text not null default 'work' check (sphere in ('work','private')),
  note        text,                                 -- krótko: brandy, rola Piotra
  ended_at    timestamptz,                          -- koniec współpracy: firma w archiwum, zasady zostają
  created_at  timestamptz not null default now()
);
create index if not exists companies_owner on companies(owner_id);

alter table projects add column if not exists company_id uuid references companies(id) on delete set null;

alter table rules add column if not exists company_id        uuid references companies(id) on delete cascade;   -- zakres „firma”
alter table rules add column if not exists origin_company_id uuid references companies(id) on delete set null;  -- gdzie wypracowana; null = moja
alter table rules drop constraint if exists rules_scope_check;
alter table rules add constraint rules_scope_check check (scope in ('global','company','project','tool'));
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'rules_company_check') then
    alter table rules add constraint rules_company_check check (scope <> 'company' or company_id is not null);
  end if;
end $$;

alter table rule_versions add column if not exists company_id        uuid;
alter table rule_versions add column if not exists origin_company_id uuid;
