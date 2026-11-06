-- Paczka 56: „Ile czasu to zajęło?” stoi na dole kartki po zamknięciu kroku Piotra (albo po jego zgodzie na szkic), dopóki nie wybierze
-- albo nie pominie (spent_manual). Kroki zamknięte i zatwierdzone przed tą zmianą nie pytają: liczą się jak odpowiedziane.
update steps set spent_manual = true where spent_manual = false and (status = 'done' or approval is not null);
