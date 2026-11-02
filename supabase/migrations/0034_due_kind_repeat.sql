-- Termin zadania i kroku: rodzaj („by” = zrób do, najpóźniejsza data; „on” = w dniu, konkretny dzień) i reguła powtarzania
-- ({"every": N, "unit": "day"|"week"|"month"}, null = bez powtarzania). Istniejące terminy zadań to „zrób do”.
-- Krok dostaje własny termin (dotąd tylko zadanie go miało), żeby i krok mógł się powtarzać.
alter table tasks add column if not exists due_kind text not null default 'by';
alter table tasks add column if not exists repeat jsonb;
alter table steps add column if not exists due date;
alter table steps add column if not exists due_kind text not null default 'by';
alter table steps add column if not exists repeat jsonb;
do $$ begin
  alter table tasks add constraint tasks_due_kind check (due_kind in ('by', 'on'));
exception when duplicate_object then null; end $$;
do $$ begin
  alter table steps add constraint steps_due_kind check (due_kind in ('by', 'on'));
exception when duplicate_object then null; end $$;
