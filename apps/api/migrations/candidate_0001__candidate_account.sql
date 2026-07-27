-- candidate_account e candidate_refresh_token sao GLOBAIS de proposito
-- (ver comentario da Task 2 do plano) -- um candidato tem uma unica conta
-- na plataforma inteira, independente de quantos tenants ele se candidata.
CREATE TABLE candidate_account (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  person_id          uuid NOT NULL REFERENCES person(id),
  email              text NOT NULL,
  senha_hash         text NOT NULL,
  email_verificado_em timestamptz,
  criado_em          timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX idx_candidate_account_email ON candidate_account (lower(email));
CREATE INDEX idx_candidate_account_person ON candidate_account (person_id);

GRANT SELECT, INSERT, UPDATE ON candidate_account TO app_runtime;

CREATE TABLE candidate_refresh_token (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  candidate_account_id  uuid NOT NULL REFERENCES candidate_account(id),
  token_hash            text NOT NULL,
  expira_em             timestamptz NOT NULL,
  revogado_em           timestamptz,
  criado_em             timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX idx_candidate_refresh_token_hash ON candidate_refresh_token (token_hash);
CREATE INDEX idx_candidate_refresh_token_account ON candidate_refresh_token (candidate_account_id);

GRANT SELECT, INSERT, UPDATE ON candidate_refresh_token TO app_runtime;
