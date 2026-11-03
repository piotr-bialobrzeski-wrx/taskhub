-- Paczka 45: krok, którego szkic już poszedł do aplikacji, a który ktoś przywrócił do zrobienia, wraca do stanu „zrobiony”.
-- Karta pokazywała „Już wysłano”, a kafelek na kanwie „Ruszy samo”. Od tej paczki takiego kroku nie da się otworzyć ponownie.
-- Bez kroków w trakcie wysyłki (send_started_at): te zamyka sam bieg wysyłki.

-- zapis zgody Piotra skasowało ponowne otwarcie: odtworzony z biegu wysyłki, jak w 0026
update steps s set approval = jsonb_build_object('at', null, 'before', r.first, 'by', 'owner', 'source', 'send-run')
from (select step_id, min(started_at) as first from bridge_runs where kind = 'send' and step_id is not null group by step_id) r
where r.step_id = s.id and s.approval is null and s.status <> 'done' and s.send_started_at is null
  and s.blocks @> '[{"type": "draft", "status": "sent"}]'::jsonb;

update steps set status = 'done', prev_status = null, handoff_at = null, cloud = null, left_at = null,
  done_at = coalesce(done_at, blocks_at, now()), done_by = coalesce(done_by, 'agent')
where status <> 'done' and send_started_at is null and blocks @> '[{"type": "draft", "status": "sent"}]'::jsonb;
