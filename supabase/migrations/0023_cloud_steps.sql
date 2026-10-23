-- „Uruchom w chmurze” (paczka 13, punkt 3): krok Piotra „Zleć w projekcie: …” albo „Wdróż na produkcję” robi wątek projektu Claude w chmurze.
-- Piotr klika w Task Hub, mostek na Macu odpala zaplanowane zadanie w chmurze, a sesja w chmurze bierze krok przez take_cloud_step.
-- {state: queued | rung | working, at: kiedy Piotr kliknął, rungAt: kiedy Mac odpalił chmurę, takenAt: kiedy chmura wzięła krok}
alter table steps add column if not exists cloud jsonb;
create index if not exists steps_cloud_idx on steps ((cloud->>'state')) where cloud is not null;
