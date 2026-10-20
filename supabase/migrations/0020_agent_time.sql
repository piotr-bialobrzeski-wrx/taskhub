-- Paczka 7, punkt 1: kto zamknął krok, czas Piotra (spent_sec) i czas Claude'a (agent_sec) osobno, kalibracja osobno
alter table steps add column if not exists agent_sec int not null default 0;
alter table steps add column if not exists agent_started_at timestamptz;
alter table steps add column if not exists done_by text check (done_by in ('owner', 'agent'));
alter table bridge_runs add column if not exists mark_at timestamptz;
alter table time_samples add column if not exists who text not null default 'owner' check (who in ('owner', 'agent'));
update steps set agent_sec = agent_sec + spent_sec, spent_sec = 0, spent_manual = false where tool <> 'manual' and spent_sec > 0;
update time_samples set who = 'agent' where tool <> 'manual';
