-- Szacunek kroku w kwantach 5 min (paczka 6, punkt 1): minimum 5 zamiast 15.
alter table steps drop constraint if exists steps_est_min_check;
alter table steps add constraint steps_est_min_check check (est_min >= 5);
-- nowy krok bez podanego szacunku startuje od 5 min
alter table steps alter column est_min set default 5;
