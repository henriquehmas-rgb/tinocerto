-- consent.finalidade ganha 'autodeclaracao_diversidade' -- base legal
-- correta para a autodeclaração de gênero/raça-cor/faixa etária/PcD que
-- alimenta o painel de impacto adverso (Fase 2c). Dado sensível (LGPD
-- art. 11) exige consentimento específico e destacado -- nunca a
-- finalidade genérica 'processo_seletivo', que cobriria coleta de dado
-- comum, não sensível. Mesmo padrão de extensão de CHECK já usado em
-- trust_0005__consent_finalidade_processo_seletivo.sql.
ALTER TABLE consent DROP CONSTRAINT consent_finalidade_check;

ALTER TABLE consent ADD CONSTRAINT consent_finalidade_check
  CHECK (finalidade IN (
    'banco_talentos',
    'pesquisa_normativa',
    'reaproveitamento_resultado',
    'marketing',
    'processo_seletivo',
    'autodeclaracao_diversidade'
  ));
