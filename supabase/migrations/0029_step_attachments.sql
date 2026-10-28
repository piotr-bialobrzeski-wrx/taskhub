-- Grafiki kroku (paczka 27): przy rozpisaniu agent przypisuje każdemu krokowi tylko te załączniki zadania, których krok potrzebuje.
-- null = krok sprzed paczki 27 (nieprzypisany): „Skąd” nie pokazuje wtedy grafik zadania, agent widzi wszystkie jak dawniej; [] = żadnych.
alter table steps add column if not exists attachment_ids uuid[];
-- Miniatura grafiki do „Skąd” i galerii zadania (do 640 px, JPEG): robiona przy pierwszym podglądzie, potem z bazy idzie tylko ona.
alter table attachments add column if not exists thumb bytea;
