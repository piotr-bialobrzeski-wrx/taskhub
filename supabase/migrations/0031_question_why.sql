-- Paczka 31: uzasadnienie zalecanej opcji pytania agenta (jedno zdanie), pokazywane tuż przy jej przycisku z oznaczeniem „Polecam”.
alter table questions add column if not exists recommended_why text;
