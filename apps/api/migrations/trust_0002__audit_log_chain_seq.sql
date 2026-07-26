-- Corrige dois achados da revisao adversarial da Task 13 (audit_log_entry):
--
-- 1) [Critical] A cadeia de hash bifurcava sob concorrencia: append()
--    escolhia o predecessor com `ORDER BY occurred_at DESC LIMIT 1` em
--    READ COMMITTED, sem lock nem constraint que serializasse. Duas
--    transacoes concorrentes liam o mesmo "ultimo hash" antes de qualquer
--    commit e ambas gravavam o mesmo prev_hash -- reproduzido como 7 de 10
--    escritas concorrentes colidindo no mesmo predecessor, 8 pontas de
--    cadeia onde deveria haver 1.
--
-- 2) [Important] occurred_at e fornecido pelo chamador (dado de negocio,
--    nao gerado pelo banco), nao e unico nem monotonico. Um evento fora de
--    ordem (ex.: consumidor de outbox reprocessando um evento atrasado --
--    cenario real da Task 14) fazia `ORDER BY occurred_at` escolher o
--    predecessor errado e quebrar a cadeia sem nenhuma adulteracao real.
--
-- chain_seq separa "quando o evento aconteceu" (occurred_at, dado de
-- negocio, sem constraint) de "posicao na cadeia" (chain_seq, controlada
-- pelo banco via UNIQUE, atribuida por audit-log.service.ts sob um
-- advisory lock por tenant -- ver comentario em append()). O predecessor
-- passa a ser escolhido por `ORDER BY chain_seq DESC LIMIT 1`.
ALTER TABLE audit_log_entry ADD COLUMN chain_seq bigint;

-- Backfill defensivo: a tabela nasceu nesta mesma task e esta vazia em
-- producao/dev neste momento, mas o UPDATE cobre sem drama qualquer
-- ambiente (ex.: homologacao) que ja tenha linhas gravadas antes desta
-- migration, ordenando pela melhor aproximacao disponivel da ordem real de
-- insercao (occurred_at, id) antes de chain_seq existir.
UPDATE audit_log_entry
SET chain_seq = sub.rn
FROM (
  SELECT id, row_number() OVER (PARTITION BY tenant_id ORDER BY occurred_at, id) AS rn
  FROM audit_log_entry
) sub
WHERE audit_log_entry.id = sub.id;

ALTER TABLE audit_log_entry ALTER COLUMN chain_seq SET NOT NULL;

-- Constraint que faz valer a serializacao: a segunda escrita concorrente
-- que tentar a mesma posicao falha com unique_violation em vez de
-- bifurcar a cadeia silenciosamente. Com o advisory lock em
-- audit-log.service.ts isso nunca deveria disparar em operacao normal --
-- e a defesa em profundidade para o caso de o lock ser removido/contornado
-- por um bug futuro.
CREATE UNIQUE INDEX idx_audit_log_tenant_chain_seq ON audit_log_entry (tenant_id, chain_seq);

-- Defesa em profundidade adicional (achado 1, opcao b da revisao): impede
-- duas entradas do mesmo tenant apontando para o mesmo predecessor.
-- Ressalva documentada: Postgres nao considera dois NULLs iguais em index
-- UNIQUE, entao esta constraint sozinha nao impediria duas "primeiras
-- entradas" (prev_hash NULL) do mesmo tenant -- quem fecha esse caso e o
-- UNIQUE(tenant_id, chain_seq) acima, que so permite um chain_seq = 1 por
-- tenant.
CREATE UNIQUE INDEX idx_audit_log_tenant_prev_hash ON audit_log_entry (tenant_id, prev_hash);
