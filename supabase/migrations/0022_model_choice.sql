-- Dobór modelu i wysiłku do kroku (zasada „Dobór modelu i wysiłku”): poziom pracy kroku, wybór Piotra, eskalacja po nieudanym biegu,
-- model i wysiłek biegu mostka oraz „ostatnio: model · wysiłek” na karcie kroku
alter table steps add column if not exists work_level text check (work_level in ('strategy', 'analysis', 'execution', 'mechanics'));   -- null = z narzędzia kroku
alter table steps add column if not exists model_pick text;                  -- wybór Piotra na karcie: null = auto, inaczej skrót modelu z listy w ustawieniach
alter table steps add column if not exists escalation int not null default 0;   -- ile poziomów wyżej po oddanych krokach (najwyżej 2)
alter table steps add column if not exists last_run jsonb;                   -- {model, effort, at}: ostatni bieg, który dotknął kroku
alter table bridge_runs add column if not exists model text;                 -- model, który bieg dostał (skrót)
alter table bridge_runs add column if not exists effort text;
alter table bridge_runs add column if not exists focus text;                 -- grupa pracy „model|wysiłek” przed modelem zapasowym: list_work biegu pokazuje tylko ją
alter table bridge_runs add column if not exists fallback text;              -- model zapasowy na przeciążenie w trakcie biegu (--fallback-model)
alter table bridge_runs add column if not exists model_used text;            -- pełna nazwa z init Claude Code

-- poziomy z zasady „Dobór modelu i wysiłku” jako dane (zmienia się je w Ustawieniach → Agent, nie w kodzie)
update users set settings = settings || '{"models": {
  "choices": ["fable", "opus", "sonnet", "haiku"],
  "levels": {
    "strategy":  {"model": "opus",   "effort": "high",   "fallback": "fable"},
    "analysis":  {"model": "opus",   "effort": "medium", "fallback": "sonnet"},
    "execution": {"model": "sonnet", "effort": "medium", "fallback": "opus"},
    "mechanics": {"model": "haiku",  "effort": "low",    "fallback": "sonnet"}
  }
}}'::jsonb where not (settings ? 'models');
