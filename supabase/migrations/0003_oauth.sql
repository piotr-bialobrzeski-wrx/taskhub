-- Konektory OAuth (aplikacja Claude, ChatGPT, Claude Code): zarejestrowani klienci i jednorazowe kody zgody.
-- Token dostępu wydany po zgodzie to zwykły token MCP w api_tokens, widoczny i do unieważnienia w Ustawieniach.
create table if not exists oauth_clients (
  id            text primary key,
  name          text not null,
  redirect_uris jsonb not null,
  secret_hash   text,
  auth_method   text not null default 'none',
  metadata      jsonb,
  created_at    timestamptz not null default now()
);

create table if not exists oauth_codes (
  code_hash      text primary key,
  client_id      text not null references oauth_clients(id) on delete cascade,
  owner_id       uuid not null references users(id) on delete cascade,
  redirect_uri   text not null,
  code_challenge text not null,
  scope          text,
  resource       text,
  expires_at     timestamptz not null,
  used_at        timestamptz,
  created_at     timestamptz not null default now()
);
create index if not exists oauth_codes_expires on oauth_codes (expires_at);
