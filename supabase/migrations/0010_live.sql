-- Praca na żywo: bieg mostka wie, nad którym zadaniem i krokiem pracuje (z notatek „get_task: id”, „start_step: id”),
-- wiadomość Piotra w zadaniu jest pracą dla agenta, dopóki jej nie przeczyta (seen_at), a tytuł przepisany przez agenta pamięta oryginał.
alter table bridge_runs add column if not exists task_id uuid references tasks(id) on delete set null;
alter table bridge_runs add column if not exists step_id uuid references steps(id) on delete set null;

alter table chat_messages add column if not exists seen_at timestamptz;   -- agent (mostek albo automat) odczytał wiadomość Piotra; null = czeka
update chat_messages set seen_at = created_at where role = 'user' and seen_at is null;   -- dotychczasowe wpisy nie stają się nagle pracą
create index if not exists chat_unseen on chat_messages(owner_id, created_at) where role = 'user' and seen_at is null and task_id is not null;

alter table tasks add column if not exists title_original text;   -- tytuł wpisany przez Piotra, gdy agent go przepisał (widoczny pod „Jak wpadło”)
