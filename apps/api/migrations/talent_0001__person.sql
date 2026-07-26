-- person e person_profile são GLOBAIS, deliberadamente sem tenant_id —
-- ver 00-decisoes-base.md ("identidade do candidato: global com ponte de
-- consentimento"). Nenhum tenant consulta esta tabela diretamente; o
-- caminho de acesso é sempre application (tenant_id) -> result_grant
-- (tenant_id) -> assessment_result (global). Qualquer código de domínio
-- que precise ler person fora de PersonService deve passar por um
-- PersonView projetado (Task 9), nunca SQL direto de outro módulo.
CREATE TABLE person (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cpf_hash         text NOT NULL,
  cpf_encriptado   jsonb NOT NULL,
  nome             text NOT NULL,
  email_principal  text NOT NULL,
  criado_em        timestamptz NOT NULL DEFAULT now()
);

-- Índice único no HASH, nunca no CPF em claro -- é o que permite localizar
-- "este CPF já existe?" sem descriptografar em massa a cada candidatura.
CREATE UNIQUE INDEX idx_person_cpf_hash ON person (cpf_hash);

CREATE TABLE person_profile (
  person_id     uuid PRIMARY KEY REFERENCES person(id),
  resumo        text,
  experiencias  jsonb NOT NULL DEFAULT '[]',
  formacao      jsonb NOT NULL DEFAULT '[]',
  habilidades   jsonb NOT NULL DEFAULT '[]',
  atualizado_em timestamptz NOT NULL DEFAULT now()
);

-- Sem RLS de propósito (ver comentário acima). GRANT explícito, sem
-- ALTER DEFAULT PRIVILEGES (regra global da Fase 0).
GRANT SELECT, INSERT, UPDATE ON person TO app_runtime;
GRANT SELECT, INSERT, UPDATE ON person_profile TO app_runtime;
