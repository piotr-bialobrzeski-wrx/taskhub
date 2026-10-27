-- Paczka 22 (ochrona zgody na szkice): trwały zapis zgody Piotra na szkic, który zostaje po wysyłce (approved_at i approved_sig znikają, gdy krok
-- się kończy). {at, by, sig, excerpt, source}: kiedy, kto, podpis i początek zatwierdzonej treści; source = click (kliknięcie „Zatwierdź”)
-- albo send-run (zapis odtworzony z biegu wysyłki: zgoda była ważna przed jego startem, godzina kliknięcia nieznana, stąd before).
alter table steps add column if not exists approval jsonb;

-- zgody ważne teraz (szkic czeka na wysyłkę albo właśnie się wysyła)
update steps set approval = jsonb_build_object('at', approved_at, 'by', 'owner', 'sig', approved_sig, 'source', 'click')
where approved_at is not null and approval is null;

-- wysłane wcześniej: bieg wysyłki bierze szkic tylko przy ważnej zgodzie (podpis z kliknięcia), więc jego start to górna granica godziny zgody
update steps s set approval = jsonb_build_object('at', null, 'before', r.first, 'by', 'owner', 'source', 'send-run')
from (select step_id, min(started_at) as first from bridge_runs where kind = 'send' and step_id is not null group by step_id) r
where r.step_id = s.id and s.status = 'done' and s.approval is null;
