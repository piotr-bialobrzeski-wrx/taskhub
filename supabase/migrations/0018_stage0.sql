-- Etap 0 (2026-10-20): szkic wysyła się tylko po kliknięciu Piotra. Zgoda to podpis treści (sha256) zapisywany wyłącznie przez akcję „Zatwierdź”;
-- każda zmiana treści szkicu ją kasuje. Wysyłka idzie osobnym biegiem mostka z krótkim tokenem, który zna tylko ten jeden krok.
alter table steps add column if not exists approved_at timestamptz;       -- kiedy Piotr zatwierdził szkic
alter table steps add column if not exists approved_sig text;             -- podpis zatwierdzonej treści (cel, temat, treść, pola, wiersze, id kroku)
alter table steps add column if not exists send_started_at timestamptz;   -- bieg wysyłki wziął szkic; najwyżej raz, bez ponawiania
create index if not exists steps_approved on steps(approved_at) where approved_at is not null;

-- token biegu: rodzaj "run", wygasa sam, zakres {kind: work | send, runId, stepId, taskId}
alter table api_tokens add column if not exists expires_at timestamptz;
alter table api_tokens add column if not exists scope jsonb;
create index if not exists api_tokens_run on api_tokens ((scope->>'runId')) where kind = 'run';

-- bieg pracy albo wysyłki; nadal jeden otwarty bieg na właściciela (indeks bridge_runs_one_open zostaje)
alter table bridge_runs add column if not exists kind text not null default 'work';   -- work | send

-- Zgody sprzed podpisów nie mają podpisu: zatwierdzone, niewysłane szkice wracają do zatwierdzenia, Piotr zatwierdza je ponownie.
update steps set
  blocks = (select jsonb_agg(case when b->>'type' = 'draft' and b->>'status' = 'approved' then b || '{"status": "proposed"}'::jsonb else b end order by i)
            from jsonb_array_elements(steps.blocks) with ordinality as x(b, i)),
  status = case when status = 'handoff' then 'draft' else status end,
  prev_status = case when status = 'handoff' then null else prev_status end,
  handoff_at = case when status = 'handoff' then null else handoff_at end
where status <> 'done' and jsonb_typeof(blocks) = 'array'
  and exists (select 1 from jsonb_array_elements(steps.blocks) b where b->>'type' = 'draft' and b->>'status' = 'approved');
-- stary szkic bez bloku (sama treść w output), „zatwierdzony” przez stan handoff po draft: też wraca do zatwierdzenia
update steps set status = 'draft', prev_status = null, handoff_at = null where status = 'handoff' and prev_status = 'draft';
