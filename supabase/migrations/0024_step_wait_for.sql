-- Krok oddany, bo czeka na inny krok (paczka 14, punkt 1): wait_for = ten drugi krok (z dowolnego zadania). Dopóki tamten nie jest zrobiony,
-- oddany krok nie wraca do list_work. Pusty = nie czeka; zapisuje go każde leave_step (nowe oddanie bez wskazania czyści).
alter table steps add column if not exists wait_for uuid;
