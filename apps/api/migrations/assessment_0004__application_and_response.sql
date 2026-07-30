-- Ponte TENANT-SCOPED: liga uma candidatura (Hiring) a uma versão de
-- instrumento. É aqui que mora o isolamento entre clientes.
CREATE TABLE assessment_application (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id             uuid NOT NULL REFERENCES tenant(id),
  application_id        uuid NOT NULL,
  person_id             uuid NOT NULL REFERENCES person(id),
  instrument_version_id uuid NOT NULL REFERENCES instrument_version(id),
  status                text NOT NULL DEFAULT 'convidado'
                        CHECK (status IN ('convidado', 'iniciado', 'concluido', 'expirado')),
  nivel_integridade     integer NOT NULL DEFAULT 0 CHECK (nivel_integridade BETWEEN 0 AND 4),
  -- Acessibilidade: multiplicador de tempo documentado por candidato.
  -- NULL = sem limite de tempo.
  multiplicador_tempo   numeric(3,1) CHECK (multiplicador_tempo IN (1.0, 1.5, 2.0)),
  convidado_em          timestamptz NOT NULL DEFAULT now(),
  iniciado_em           timestamptz,
  concluido_em          timestamptz,
  expira_em             timestamptz,
  CONSTRAINT fk_aa_tenant_application FOREIGN KEY (tenant_id, application_id)
    REFERENCES application (tenant_id, id)
);

ALTER TABLE assessment_application ADD CONSTRAINT uq_aa_tenant_id UNIQUE (tenant_id, id);
CREATE INDEX idx_aa_tenant_application ON assessment_application (tenant_id, application_id);
CREATE INDEX idx_aa_tenant_status ON assessment_application (tenant_id, status);

GRANT SELECT, INSERT, UPDATE ON assessment_application TO app_runtime;

ALTER TABLE assessment_application ENABLE ROW LEVEL SECURITY;
ALTER TABLE assessment_application FORCE  ROW LEVEL SECURITY;

CREATE POLICY allow_all_base ON assessment_application
  AS PERMISSIVE FOR ALL TO app_runtime
  USING (true)
  WITH CHECK (true);

-- NULLIF obrigatório: o cast direto estoura 22P02 em conexão reciclada do
-- pool e já derrubou o processo inteiro uma vez (platform_0002).
CREATE POLICY tenant_isolation ON assessment_application
  AS RESTRICTIVE FOR ALL TO app_runtime
  USING      (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

-- SILO: resposta bruta item a item. GLOBAL (sem tenant_id) e CRIPTOGRAFADA.
-- É o dado mais sensível do produto e o único que permite calibrar. Nenhum
-- caminho de leitura de tenant devolve isto -- o tenant lê assessment_result
-- via result_grant. Mesma lógica da identidade global do candidato.
CREATE TABLE item_response (
  id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  assessment_application_id uuid NOT NULL REFERENCES assessment_application(id),
  block_id                  uuid NOT NULL REFERENCES block(id),
  -- Payload criptografado (envelope, EnvelopeEncryptionService da Fase 1a):
  -- { maisId, menosId, itemIds } -- a escolha bruta do respondente.
  resposta_criptografada    jsonb NOT NULL,
  respondido_em             timestamptz NOT NULL DEFAULT now(),
  duracao_ms                integer,
  CONSTRAINT uq_item_response_bloco UNIQUE (assessment_application_id, block_id)
);

CREATE INDEX idx_item_response_aplicacao ON item_response (assessment_application_id);

-- Sem DELETE: a resposta é o dado que calibra. Apagar é perda irreversível
-- de amostra; retenção/expurgo é responsabilidade do domínio Trust, com
-- trilha de auditoria, nunca de um DELETE solto de aplicação.
GRANT SELECT, INSERT ON item_response TO app_runtime;

-- Meta de calibração. Uma calibration_run bem-sucedida é o que produz
-- item_parameter_version com provisorio = false -- e portanto o que
-- destrava o CAT (ver Task 10).
CREATE TABLE calibration_run (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  instrument_version_id uuid NOT NULL REFERENCES instrument_version(id),
  metodo                text NOT NULL,
  n_respondentes        integer NOT NULL,
  calibracao_versao     text NOT NULL,
  executado_em          timestamptz NOT NULL DEFAULT now(),
  resultado             jsonb,
  CONSTRAINT uq_calibration_versao UNIQUE (calibracao_versao)
);

GRANT SELECT, INSERT ON calibration_run TO app_runtime;
