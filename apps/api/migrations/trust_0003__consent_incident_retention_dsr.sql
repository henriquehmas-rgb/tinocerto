-- Nota de numeracao: o rascunho original da Task 14 (brief) nomeava esta
-- migration como trust_0002__consent_incident_retention_dsr.sql, mas
-- trust_0002 ja foi usado por trust_0002__audit_log_chain_seq.sql (Task 13,
-- correcao de hash chain sob concorrencia) e ja esta aplicado no banco.
-- Renumerada para trust_0003 mantendo o mesmo conteudo do brief.

-- person_id não tem FK ainda: a tabela `person` só existe no domínio
-- Talent, criada na Fase 1. Este é um forward-reference deliberado,
-- documentado aqui e não escondido — consent é owned por Trust desde a
-- Fase 0 porque é o sistema de registro de base legal de toda a
-- plataforma (ver 03-arquitetura-e-modelo-de-dados.md §2.3).
CREATE TABLE consent (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  person_id    uuid NOT NULL,
  tenant_id    uuid REFERENCES tenant(id),
  finalidade   text NOT NULL CHECK (finalidade IN ('banco_talentos','pesquisa_normativa','reaproveitamento_resultado','marketing')),
  base_legal   text NOT NULL,
  granted_at   timestamptz NOT NULL DEFAULT now(),
  revoked_at   timestamptz,
  ttl_meses    int
);

CREATE INDEX idx_consent_person ON consent (person_id);

CREATE TABLE security_incident (
  id                            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  detectado_em                  timestamptz NOT NULL,
  categoria                     text NOT NULL,
  titulares_afetados_estimativa int,
  categorias_dados              text[],
  notificado_anpd_em            timestamptz,
  CONSTRAINT chk_prazo_anpd CHECK (notificado_anpd_em IS NULL OR notificado_anpd_em >= detectado_em)
);

CREATE TABLE retention_policy (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid REFERENCES tenant(id),
  tipo_dado   text NOT NULL,
  ttl_meses   int NOT NULL,
  acao        text NOT NULL CHECK (acao IN ('anonimizar', 'eliminar'))
);

CREATE TABLE data_subject_request (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  person_id     uuid NOT NULL,
  tipo          text NOT NULL,
  status        text NOT NULL DEFAULT 'pendente',
  prazo_legal   timestamptz,
  concluido_em  timestamptz
);

GRANT SELECT, INSERT, UPDATE ON consent TO app_runtime;
GRANT SELECT, INSERT, UPDATE ON security_incident TO app_runtime;
GRANT SELECT, INSERT, UPDATE, DELETE ON retention_policy TO app_runtime;
GRANT SELECT, INSERT, UPDATE ON data_subject_request TO app_runtime;

-- Nota: nenhuma dessas quatro tabelas tem RLS por tenant_id obrigatório
-- porque tenant_id é nullable em consent/retention_policy (consentimento de
-- plataforma não pertence a um tenant) e security_incident/
-- data_subject_request são, por natureza, registros que precisam ser
-- consultáveis por titular/categoria através de tenants na resposta a
-- incidente (ver 02-requisitos-e-compliance.md §3.6) — isolamento aqui é
-- por person_id/query explícita na camada de aplicação, não por RLS de
-- tabela. Exceção deliberada e documentada, não uma omissão.
