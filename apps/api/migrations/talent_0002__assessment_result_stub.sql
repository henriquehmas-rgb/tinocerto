-- assessment_result é GLOBAL como person (ver talent_0001) -- é o ativo
-- que torna o teste "feito uma vez, reaproveitado entre tenants". Esta
-- fase não grava nada aqui; a Fase 2 (motor TRI) é quem preenche
-- theta/se_theta/escore_bruto de verdade. instrument_version_id não tem
-- FK ainda porque a tabela instrument_version (domínio Assessment) só
-- existe a partir da Fase 2 -- confirmado consciente, não esquecido: a
-- referência é validada em nível de aplicação até a Fase 2 criar a FK.
CREATE TABLE assessment_result (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  person_id             uuid NOT NULL REFERENCES person(id),
  instrument_version_id uuid NOT NULL,
  theta                 jsonb,
  se_theta              jsonb,
  escore_bruto          jsonb,
  protocolo_confianca   numeric(3,2),
  respondido_em         timestamptz,
  calibracao_versao     text
);

CREATE INDEX idx_assessment_result_person ON assessment_result (person_id);

GRANT SELECT, INSERT, UPDATE ON assessment_result TO app_runtime;

-- result_grant É tenant-scoped -- a ponte de consentimento entre o
-- resultado global e o tenant que tem permissão de enxergá-lo. Segue o
-- padrão FORCE+RESTRICTIVE de toda tabela com tenant_id da Fase 0.
CREATE TABLE result_grant (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  assessment_result_id  uuid NOT NULL REFERENCES assessment_result(id),
  tenant_id             uuid NOT NULL REFERENCES tenant(id),
  application_id        uuid,
  -- consent_id: FK SIMPLES de propósito, não composta com tenant_id --
  -- consent.tenant_id é NULLABLE (consentimento de plataforma, ex. banco
  -- de talentos geral, não pertence a nenhum tenant específico). Uma FK
  -- composta (tenant_id, consent_id) rejeitaria exatamente o caso
  -- legítimo de um result_grant tenant-scoped apontando para um consent
  -- de plataforma (tenant_id NULL) -- NULL nunca combina com um valor
  -- concreto em FK composta. Esta é a única FK desta fase que
  -- deliberadamente foge do padrão de FK composta do Global Constraints,
  -- e é por isso, não por descuido.
  consent_id            uuid NOT NULL REFERENCES consent(id),
  granted_at            timestamptz NOT NULL DEFAULT now(),
  expires_at            timestamptz,
  revoked_at            timestamptz
);

CREATE INDEX idx_result_grant_tenant_result ON result_grant (tenant_id, assessment_result_id);

GRANT SELECT, INSERT, UPDATE ON result_grant TO app_runtime;

ALTER TABLE result_grant ENABLE ROW LEVEL SECURITY;
ALTER TABLE result_grant FORCE  ROW LEVEL SECURITY;

CREATE POLICY allow_all_base ON result_grant
  AS PERMISSIVE FOR ALL TO app_runtime
  USING (true)
  WITH CHECK (true);

CREATE POLICY tenant_isolation ON result_grant
  AS RESTRICTIVE FOR ALL TO app_runtime
  USING      (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);
