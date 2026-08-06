--
-- avaliador_id precisa estar cadastrado como interview_evaluator DAQUELE
-- interview_schedule_id -- não dá para expressar isso como FK simples
-- (são 2 colunas contra uma chave de 3), então é trigger, mesmo padrão
-- já usado para demographic_self_report/consent em fase anterior
-- (trust_0008__demographic_self_report_consent_tenant_coerencia.sql --
-- leia esse arquivo se quiser conferir o precedente exato).
CREATE TABLE scorecard (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id              uuid NOT NULL REFERENCES tenant(id),
  interview_schedule_id  uuid NOT NULL,
  avaliador_id           uuid NOT NULL,
  notas_por_competencia  jsonb NOT NULL DEFAULT '{}'::jsonb,
  comentario             text,
  submetido_em           timestamptz,
  criado_em              timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT fk_scorecard_tenant_schedule FOREIGN KEY (tenant_id, interview_schedule_id)
    REFERENCES interview_schedule (tenant_id, id),
  CONSTRAINT uq_scorecard_schedule_avaliador UNIQUE (tenant_id, interview_schedule_id, avaliador_id)
);

GRANT SELECT, INSERT, UPDATE ON scorecard TO app_runtime;

ALTER TABLE scorecard ENABLE ROW LEVEL SECURITY;
ALTER TABLE scorecard FORCE  ROW LEVEL SECURITY;

CREATE POLICY allow_all_base ON scorecard
  AS PERMISSIVE FOR ALL TO app_runtime
  USING (true)
  WITH CHECK (true);

CREATE POLICY tenant_isolation ON scorecard
  AS RESTRICTIVE FOR ALL TO app_runtime
  USING      (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

CREATE FUNCTION assert_scorecard_avaliador_e_evaluator()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM interview_evaluator ie
     WHERE ie.tenant_id = NEW.tenant_id
       AND ie.interview_schedule_id = NEW.interview_schedule_id
       AND ie.user_id = NEW.avaliador_id
  ) THEN
    RAISE EXCEPTION
      'scorecard do tenant % não pode ter avaliador_id % para interview_schedule %: avaliador não está cadastrado como interview_evaluator desta entrevista',
      NEW.tenant_id, NEW.avaliador_id, NEW.interview_schedule_id;
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER trg_scorecard_avaliador_e_evaluator
  BEFORE INSERT OR UPDATE ON scorecard
  FOR EACH ROW EXECUTE FUNCTION assert_scorecard_avaliador_e_evaluator();
