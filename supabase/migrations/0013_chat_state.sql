-- Stan wiadomości Piotra w zadaniu (paczka 2, punkt 1): seen_at = wzięta do opracowania w bieżącym biegu agenta,
-- answered_at = załatwiona (reply_chat mostka albo odpowiedź agenta w aplikacji). Wiadomość wzięta, ale bez odpowiedzi, wraca do kolejki po końcu biegu.
alter table chat_messages add column if not exists answered_at timestamptz;
update chat_messages set answered_at = seen_at where role = 'user' and answered_at is null and seen_at is not null;   -- dotychczas „przeczytana” znaczyło „załatwiona”
create index if not exists chat_pending on chat_messages(owner_id, task_id, created_at) where role = 'user' and answered_at is null and task_id is not null;
