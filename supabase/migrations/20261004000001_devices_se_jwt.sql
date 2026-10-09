-- Annonceur chat multi-canaux : JWT API StreamElements propre à chaque canal.
-- Le sender utilise devices.se_jwt si présent, sinon le secret global de
-- fonction SE_JWT (comportement mono-canal historique — canal marc).
alter table devices
  add column se_jwt text;
