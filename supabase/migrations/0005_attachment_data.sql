-- Pliki wklejone lub przeciągnięte do doku trzymamy w bazie (bytea): bez osobnego magazynu plików.
-- Serwowane przez /api/files/<id> po zalogowaniu; agent dostaje je przez narzędzie MCP get_attachment.
alter table attachments add column if not exists data bytea;
