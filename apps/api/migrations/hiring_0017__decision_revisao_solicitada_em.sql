-- apps/api/migrations/hiring_0017__decision_revisao_solicitada_em.sql
--
-- hiring_0006 já criava revisao_solicitada boolean, mas sem timestamp --
-- suficiente para o schema documentado, insuficiente para a fila real que
-- esta fase constrói (um humano precisa saber HÁ QUANTO TEMPO um pedido
-- está parado, não só que existe). Nullable: só é preenchida quando
-- DecisionService.solicitarRevisao roda; decisões nunca revisadas
-- continuam com o par (false, NULL).
ALTER TABLE decision ADD COLUMN revisao_solicitada_em timestamptz;
