CREATE TABLE candidate_password_reset_token (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  candidate_account_id  uuid NOT NULL REFERENCES candidate_account(id),
  token_hash            text NOT NULL,
  expira_em             timestamptz NOT NULL,
  usado_em              timestamptz,
  criado_em             timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX idx_password_reset_token_hash ON candidate_password_reset_token (token_hash);
CREATE INDEX idx_password_reset_token_account ON candidate_password_reset_token (candidate_account_id);

GRANT SELECT, INSERT, UPDATE ON candidate_password_reset_token TO app_runtime;
