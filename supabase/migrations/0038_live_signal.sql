-- Paczka 60: sygnał w chwili zmiany zamiast odpytywania co kilkanaście sekund (limit procesora na Vercelu).
-- Każda zmiana w tabelach, z których liczy się lista pracy i widok, wysyła przez Supabase Realtime krótki sygnał „coś się zmieniło”
-- (bez danych, tylko nazwa tabeli) na kanał właściciela. Strona i mostek na Macu słuchają go i dopiero wtedy pytają Task Hub.
-- Nazwa kanału jest losowa i tajna (users.live_topic), dostaje ją tylko zalogowany właściciel i jego mostek.
-- Bez Supabase Realtime (lokalna baza, testy) funkcja nic nie robi; błąd sygnału nigdy nie psuje zapisu.

alter table users add column if not exists live_topic text default ('th-' || replace(gen_random_uuid()::text, '-', ''));
update users set live_topic = 'th-' || replace(gen_random_uuid()::text, '-', '') where live_topic is null;

create or replace function th_live_ping() returns trigger language plpgsql security definer set search_path = public as $$
declare
  r jsonb;
  o text;
  tp text;
  k text;
begin
  if to_regprocedure('realtime.send(jsonb,text,text,boolean)') is null then return null; end if;
  -- cały sygnał w osobnym bloku: żaden jego błąd nie może zatrzymać zapisu, który go wywołał
  begin
  r := case when TG_OP = 'DELETE' then to_jsonb(OLD) else to_jsonb(NEW) end;
  o := case when TG_TABLE_NAME = 'users' then r->>'id' else r->>'owner_id' end;
  if o is null and r ? 'task_id' and r->>'task_id' is not null then
    select t.owner_id::text into o from tasks t where t.id = (r->>'task_id')::uuid;
  end if;
  if o is null and r ? 'step_id' and r->>'step_id' is not null then
    select t.owner_id::text into o from steps s join tasks t on t.id = s.task_id where s.id = (r->>'step_id')::uuid;
  end if;
  if o is null then return null; end if;
  -- nazwa ustawienia: część po kropce nie może zaczynać się cyfrą, stąd „o” przed id właściciela
  k := 'th.live.' || TG_TABLE_NAME || '.o' || replace(o, '-', '');
  -- jeden sygnał na transakcję i tabelę: dodanie 10 kroków to jeden sygnał, nie dziesięć
  if current_setting(k, true) = '1' then return null; end if;
  perform set_config(k, '1', true);
  select u.live_topic into tp from users u where u.id = o::uuid;
  if tp is null then return null; end if;
  execute 'select realtime.send($1, $2, $3, false)' using jsonb_build_object('t', TG_TABLE_NAME), 'change', tp;
  exception when others then
    return null;
  end;
  return null;
end $$;

do $$
declare t text;
begin
  foreach t in array array['tasks','steps','task_dependencies','step_dependencies','chat_messages','questions','time_samples','projects','users','bridge_runs','facts'] loop
    execute format('drop trigger if exists th_live on %I', t);
    execute format('create trigger th_live after insert or update or delete on %I for each row execute function th_live_ping()', t);
  end loop;
end $$;
