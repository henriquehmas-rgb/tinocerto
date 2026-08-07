-- apps/api/migrations/hiring_0015__offer.sql
--
-- Sub-entidade rica de decision.tipo = 'oferta' (hiring_0006, coluna já
-- previa esse tipo desde a Fase 1, sem consumidor até agora). `decision`
-- continua o diário leve de toda decisão de RH (aprovação/reprovação/
-- oferta); `offer` guarda o que `decision` não tem coluna para guardar:
-- valor, ciclo de vida próprio (estendida -> aceita|recusada) e quem
-- respondeu. OfferService.extend() grava as duas linhas na MESMA
-- transação -- ver design spec §Arquitetura item 1.
--
-- accept/decline são staff-recorded nesta fase (decisão de escopo do
-- design spec, item 3): não existe ainda uma tela de auto-atendimento do
-- candidato para aceitar/recusar oferta -- um recrutador/admin registra a
-- resposta que o candidato deu por telefone/e-mail/WhatsApp, prática
-- padrão de contratação de PME no Brasil. estendido_por/respondido_por
-- são ambos uuid de user_account (staff), nunca person_id do candidato.
CREATE TABLE offer (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id             uuid NOT NULL REFERENCES tenant(id),
  application_id        uuid NOT NULL,
  valor                 numeric(12,2) NOT NULL CHECK (valor > 0),
  -- Preparo mínimo de i18n (mesmo espírito do resto do produto: BR-only
  -- agora, schema pronto para expansão depois) -- não configurável em
  -- nenhuma tela nesta fase, sempre BRL.
  moeda                 char(3) NOT NULL DEFAULT 'BRL',
  status                text NOT NULL DEFAULT 'estendida'
                        CHECK (status IN ('estendida', 'aceita', 'recusada')),
  estendido_por         uuid NOT NULL,
  estendido_em          timestamptz NOT NULL DEFAULT now(),
  respondido_por        uuid,
  respondido_em         timestamptz,
  motivo_recusa_codigo  text,
  CONSTRAINT fk_offer_tenant_application FOREIGN KEY (tenant_id, application_id)
    REFERENCES application (tenant_id, id),
  CONSTRAINT fk_offer_tenant_estendido_por FOREIGN KEY (tenant_id, estendido_por)
    REFERENCES user_account (tenant_id, id),
  CONSTRAINT fk_offer_tenant_respondido_por FOREIGN KEY (tenant_id, respondido_por)
    REFERENCES user_account (tenant_id, id),
  -- respondido_em/respondido_por só fazem sentido junto de status
  -- resolvido; uma oferta 'estendida' nunca pode já ter resposta gravada.
  -- Mesmo espírito de checagem cruzada de coluna já usado em
  -- assessment_application (iniciado_em/concluido_em coerentes com status).
  CONSTRAINT chk_offer_resposta_coerente CHECK (
    (status = 'estendida' AND respondido_por IS NULL AND respondido_em IS NULL AND motivo_recusa_codigo IS NULL)
    OR (status IN ('aceita', 'recusada') AND respondido_por IS NOT NULL AND respondido_em IS NOT NULL)
  )
);

ALTER TABLE offer ADD CONSTRAINT uq_offer_tenant_id UNIQUE (tenant_id, id);
CREATE INDEX idx_offer_tenant_application ON offer (tenant_id, application_id);

-- No máximo UMA oferta pendente de resposta por candidatura ao mesmo
-- tempo -- índice único PARCIAL, não checagem em nível de aplicação, para
-- fechar a mesma classe de corrida já evitada em scorecard (Fase 3a,
-- `WHERE scorecard.submetido_em IS NULL`). Uma nova oferta só pode ser
-- estendida depois que a pendente for respondida (aceita ou recusada).
CREATE UNIQUE INDEX uq_offer_tenant_application_pendente
  ON offer (tenant_id, application_id) WHERE status = 'estendida';

GRANT SELECT, INSERT, UPDATE ON offer TO app_runtime;

ALTER TABLE offer ENABLE ROW LEVEL SECURITY;
ALTER TABLE offer FORCE  ROW LEVEL SECURITY;

CREATE POLICY allow_all_base ON offer
  AS PERMISSIVE FOR ALL TO app_runtime
  USING (true)
  WITH CHECK (true);

CREATE POLICY tenant_isolation ON offer
  AS RESTRICTIVE FOR ALL TO app_runtime
  USING      (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
