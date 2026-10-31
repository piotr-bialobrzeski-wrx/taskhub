-- Paczka 31: układ kafelków „Pilne i szybkie” (wariant C). Pole na kanwie, które asystent ustala według zasady w bazie
-- (null = pole liczone z priorytetu i pozostałej pracy), i znacznik grup-pól na głównej kanwie (null = zwykła grupa).
alter table tasks add column if not exists lane text;
alter table canvas_groups add column if not exists lane text;
