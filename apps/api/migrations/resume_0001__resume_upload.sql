CREATE TABLE resume_upload (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  person_id       uuid NOT NULL REFERENCES person(id),
  application_id  uuid, -- referência solta e best-effort a uma application tenant-scoped, ver nota acima; nunca FK
  storage_key     text NOT NULL,
  texto_extraido  text,
  status          text NOT NULL DEFAULT 'pendente' CHECK (status IN ('pendente', 'processado', 'falhou')),
  criado_em       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_resume_upload_person ON resume_upload (person_id);

GRANT SELECT, INSERT, UPDATE ON resume_upload TO app_runtime;
