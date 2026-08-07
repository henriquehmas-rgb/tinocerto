-- apps/api/migrations/hiring_0016__application_started_work.sql
--
-- Marco manual do fim real do funil (admissão) -- 03-arquitetura §2.4/§5.2
-- já reserva o evento candidate.started_work com payload mínimo
-- start_date. Tabela dedicada (não coluna em application), mesmo padrão
-- de decision/pipeline_stage_transition: acontecimento de funil nomeado,
-- não estado mutável solto em application. UNIQUE(tenant_id,
-- application_id) torna o registro idempotente por candidatura -- uma
-- segunda tentativa é rejeitada explicitamente (ver
-- InicioTrabalhoJaRegistradoError no service), nunca sobrescreve
-- silenciosamente uma data de início já gravada. offer_id NOT NULL: o
-- serviço sempre resolve a oferta aceita mais recente antes de inserir --
-- nunca é possível gravar este marco sem uma oferta aceita real por trás
-- (checagem de integridade, não automação do próprio marco -- ver design
-- spec §Decisões fechadas, item 4).
CREATE TABLE application_started_work (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL REFERENCES tenant(id),
  application_id  uuid NOT NULL,
  offer_id        uuid NOT NULL,
  data_inicio     date NOT NULL,
  registrado_por  uuid NOT NULL,
  registrado_em   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT fk_started_work_tenant_application FOREIGN KEY (tenant_id, application_id)
    REFERENCES application (tenant_id, id),
  CONSTRAINT fk_started_work_tenant_offer FOREIGN KEY (tenant_id, offer_id)
    REFERENCES offer (tenant_id, id),
  CONSTRAINT fk_started_work_tenant_registrado_por FOREIGN KEY (tenant_id, registrado_por)
    REFERENCES user_account (tenant_id, id),
  CONSTRAINT uq_started_work_tenant_application UNIQUE (tenant_id, application_id)
);

GRANT SELECT, INSERT ON application_started_work TO app_runtime;

ALTER TABLE application_started_work ENABLE ROW LEVEL SECURITY;
ALTER TABLE application_started_work FORCE  ROW LEVEL SECURITY;

CREATE POLICY allow_all_base ON application_started_work
  AS PERMISSIVE FOR ALL TO app_runtime
  USING (true)
  WITH CHECK (true);

CREATE POLICY tenant_isolation ON application_started_work
  AS RESTRICTIVE FOR ALL TO app_runtime
  USING      (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
