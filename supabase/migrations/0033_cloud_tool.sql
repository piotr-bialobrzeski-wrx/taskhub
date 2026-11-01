-- Paczka 36: krok „Zleć w projekcie: …” to krok agenta w chmurze (narzędzie „Claude w chmurze”), nie krok Piotra.
-- Otwarte kroki zapisane dotąd jako „Ty” zmieniają narzędzie; zrobione zostają, jak były. „Wdróż na produkcję” zostaje krokiem Piotra.
update steps set tool = 'cloud'
where tool = 'manual' and status <> 'done' and title ~* '^\s*zleć w projekcie([\s,:;]|$)';
