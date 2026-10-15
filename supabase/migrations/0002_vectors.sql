-- Warstwa wektorowa (wymaga rozszerzenia pgvector, dostępnego w Supabase).
-- Oddzielna migracja: lokalnie bez pgvector aplikacja działa na wyszukiwaniu pełnotekstowym.
create extension if not exists vector;

-- kawałki tekstu do wyszukiwania semantycznego: zadania, notatki końcowe, fakty, migawki, załączniki
create table if not exists chunks (
  id          uuid primary key default gen_random_uuid(),
  owner_id    uuid not null references users(id) on delete cascade,
  task_id     uuid references tasks(id) on delete cascade,
  step_id     uuid references steps(id) on delete cascade,
  kind        text not null,                -- 'task', 'note', 'fact', 'snapshot', 'attachment'
  text        text not null,
  model       text not null,                -- nazwa modelu embeddingów (żeby móc przeliczyć innym dostawcą)
  embedding   vector(1536),
  created_at  timestamptz not null default now()
);
create index if not exists chunks_owner on chunks(owner_id, task_id);
create index if not exists chunks_embedding on chunks using hnsw (embedding vector_cosine_ops);
