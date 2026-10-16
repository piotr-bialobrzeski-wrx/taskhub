-- Rozdział zasad na trzy rodzaje (decyzja 2026-10-16): profil = dane o projekcie albo narzędziu (język, klient, kanały),
-- zasada = krótka reguła zawsze obecna w prompcie, procedura = dłuższa instrukcja podawana w całości tylko wtedy,
-- gdy pasuje wyzwalacz (narzędzie kroku, temat, słowo z tytułu kroku); inaczej agent dostaje ją w spisie samym skrótem.
alter table rules add column if not exists kind    text not null default 'rule';   -- profile | rule | procedure
alter table rules add column if not exists trigger text;                           -- procedura: słowa wyzwalające po przecinku
alter table rules add column if not exists summary text;                           -- procedura: jedno zdanie do spisu
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'rules_kind_check') then
    alter table rules add constraint rules_kind_check check (kind in ('profile','rule','procedure'));
  end if;
end $$;

-- Historia wersji: każdy zapis (dodanie, zmiana, usunięcie) zostawia migawkę brzmienia zasady, żeby dało się wrócić do wcześniejszej.
create table if not exists rule_versions (
  id          uuid primary key default gen_random_uuid(),
  rule_id     uuid not null,                       -- bez klucza obcego: migawki zostają po usunięciu zasady
  owner_id    uuid not null references users(id) on delete cascade,
  change      text not null check (change in ('created','updated','deleted')),
  kind        text not null,
  scope       text not null,
  project_id  uuid,
  tool        text,
  title       text not null,
  body        text not null,
  trigger     text,
  summary     text,
  changed_at  timestamptz not null default now()
);
create index if not exists rule_versions_rule on rule_versions(rule_id, changed_at desc);
