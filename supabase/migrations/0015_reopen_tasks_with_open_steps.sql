-- Zadanie zamknięte samo (wszystkie kroki gotowe), do którego agent dopisał potem nowe kroki, zostawało „ukończone”:
-- list_work go pomijał, więc zatwierdzone szkice nie szły do wysyłki. Takie zadania wracają do pracy.
update tasks set done_at = null
where done_at is not null and deleted_at is null
  and exists (select 1 from steps s where s.task_id = tasks.id and s.status <> 'done');
