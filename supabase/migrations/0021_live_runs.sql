-- Paczka 7, punkt 3: bieg pamięta kroki, których dotknął (zapisuje serwer MCP, nie notatki z Maca), „Zatrzymaj” w Task Hub,
-- krok zmieniony przez agenta ma kropkę do pierwszego otwarcia
alter table bridge_runs add column if not exists steps jsonb not null default '{}'::jsonb;   -- {stepId: {first, at, what}}
alter table bridge_runs add column if not exists stop_at timestamptz;
alter table steps add column if not exists agent_at timestamptz;
alter table steps add column if not exists opened_at timestamptz;
