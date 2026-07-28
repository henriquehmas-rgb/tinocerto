-- Global de propósito (sem tenant_id, mesma classe de person/resume_upload)
-- -- é um índice de leitura para o PRÓPRIO candidato ver suas candidaturas
-- espalhadas por múltiplos tenants. Nunca exposto a nenhum outro
-- candidato nem a staff; toda leitura de aplicação filtra por
-- person_id = <candidato autenticado>, aplicado em código, não em RLS
-- (não há RLS aqui porque não há tenant a isolar -- o isolamento que
-- importa é "só o próprio candidato vê sua própria linha", garantido pelo
-- WHERE da query, nunca por SELECT * sem filtro).
CREATE TABLE candidate_application_summary (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  person_id      uuid NOT NULL REFERENCES person(id),
  tenant_id      uuid NOT NULL REFERENCES tenant(id),
  application_id uuid NOT NULL,
  job_titulo     text NOT NULL,
  etapa_funil    text NOT NULL,
  reprovado_em   timestamptz,
  atualizado_em  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (application_id)
);

CREATE INDEX idx_candidate_application_summary_person ON candidate_application_summary (person_id);

GRANT SELECT, INSERT, UPDATE ON candidate_application_summary TO app_runtime;
