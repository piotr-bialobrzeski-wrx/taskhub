-- Paczka 7, punkt 4 (2026-10-20): „Plik na Macu” to nie wysyłka. Krok z narzędziem file zapisuje bieg pracy mostka (aplikacja 0.1.7)
-- w folderze na pliki z Ustawień; ścieżka zapisanego pliku to tylko tekst do skopiowania, nigdy link. Taki krok nie czeka na zgodę.
alter table steps add column if not exists file_path text;
update steps set tool = 'file' where lower(trim(tool)) in ('plik', 'plik na macu');
update steps set needs_approval = false where tool = 'file' and needs_approval;
-- otwarte szkice do pliku sprzed paczki 7 wracają do agenta jako krok „Plik na Macu”: treść zostaje na kartce (klocek free z miejscem w tytule); wysłane zostają
update steps set tool = 'file', needs_approval = false, status = 'todo', prev_status = null, handoff_at = null,
  approved_at = null, approved_sig = null, send_started_at = null,
  blocks = (select jsonb_agg(case when b->>'type' = 'draft'
      then jsonb_strip_nulls(jsonb_build_object('type', 'free', 'title', b->'target'->>'where', 'markdown', left(b->>'body', 20000)))
      else b end order by i) from jsonb_array_elements(steps.blocks) with ordinality as x(b, i))
where status <> 'done' and send_started_at is null and jsonb_typeof(blocks) = 'array'
  and exists (select 1 from jsonb_array_elements(steps.blocks) b where b->>'type' = 'draft' and lower(trim(b->'target'->>'app')) in ('plik', 'file', 'plik na macu'));
