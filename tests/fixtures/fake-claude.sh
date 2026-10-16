#!/bin/sh
# Udaje `claude -p` w trybie stream-json: dwa użycia narzędzi i wynik; z argumentem "limit" kończy błędem limitu subskrypcji.
echo '{"type":"system","subtype":"init","session_id":"s-test"}'
echo '{"type":"assistant","message":{"content":[{"type":"tool_use","name":"mcp__task-hub__list_work","input":{}}]}}'
echo '{"type":"assistant","message":{"content":[{"type":"tool_use","name":"mcp__task-hub__add_steps","input":{"taskId":"abc"}}]}}'
if [ "$1" = "limit" ]; then
  echo '{"type":"result","subtype":"error_during_execution","is_error":true,"result":"Claude AI usage limit reached|1760630400"}'
else
  echo '{"type":"result","subtype":"success","is_error":false,"result":"Rozpisałem zadanie na 3 kroki i zrobiłem research."}'
fi
