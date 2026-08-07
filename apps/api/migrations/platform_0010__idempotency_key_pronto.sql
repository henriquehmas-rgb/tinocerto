-- checkOrReserve() precisa reservar a linha ANTES do handler de negócio
-- rodar (achado de revisão: race condition permitia execução dupla do
-- handler quando duas requisições concorrentes usavam a mesma
-- Idempotency-Key). A reserva agora é um INSERT ... ON CONFLICT DO UPDATE
-- atômico feito por checkOrReserve, com resposta_snapshot ainda não
-- disponível -- `pronto` marca se a linha já tem a resposta real
-- (gravada por store()) ou é só uma reserva em andamento.
ALTER TABLE idempotency_key ADD COLUMN pronto boolean NOT NULL DEFAULT false;

GRANT UPDATE (hash_da_requisicao, resposta_snapshot, expira_em, criado_em, pronto) ON idempotency_key TO app_runtime;
