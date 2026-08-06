-- Requisitos estruturados da vaga para o score de aderência (Fase 2b):
-- lista de skills exigidas, declarada pelo recrutador -- não extraída por
-- LLM da descrição (decisão fechada no design da Fase 2b, docs/superpowers/
-- specs/2026-08-04-fase-2b-score-aderencia-design.md: determinístico, sem
-- risco de alucinação, nasce como "critério nomeado e auditável"). Mesmo
-- padrão de array simples já usado em job.canais (Fase 1a) -- sem tabela
-- nova, sem metadado por skill (peso/obrigatória) nesta fase, YAGNI até
-- existir necessidade real de diferenciar.
ALTER TABLE job ADD COLUMN habilidades_exigidas text[] NOT NULL DEFAULT '{}';
