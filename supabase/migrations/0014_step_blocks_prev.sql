-- Żywa kartka kroku: poprzednia wersja klocków, żeby Piotr mógł cofnąć zmianę, którą agent zrobił po jego odpowiedzi.
alter table steps add column if not exists blocks_prev jsonb;
