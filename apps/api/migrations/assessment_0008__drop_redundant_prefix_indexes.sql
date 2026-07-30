-- Remove índices btree de coluna única que são prefixo à esquerda de um índice
-- UNIQUE já existente na mesma tabela. Em btree, um índice (a, b) atende todas
-- as buscas, ordenações e checagens de FK que um índice (a) atenderia; manter
-- os dois só custa amplificação de escrita e espaço em disco a cada INSERT.
--
-- Redundâncias removidas (índice descartado -> índice que já o cobre):
--   idx_instrument_version_instrument (instrument_id)
--     -> uq_instrument_version (instrument_id, versao)
--   idx_block_instrument_version (instrument_version_id)
--     -> uq_block_ordem (instrument_version_id, ordem)
--   idx_block_item_block (block_id)
--     -> uq_block_item (block_id, item_id) e uq_block_posicao (block_id, posicao)
--   idx_ipv_item (item_id)
--     -> uq_ipv_item_calibracao (item_id, calibracao_versao)
--
-- O custo é real a partir da Task 8, que carrega o banco de itens IPIP em lote
-- (item_parameter_version e block_item recebem uma linha por item por bloco).
--
-- O que NÃO é removido, e por quê:
--   idx_block_item_item (item_id), criado pela assessment_0007 -- item_id não é
--     coluna líder de nenhum outro índice de block_item, então ele é o único
--     apoio da FK block_item.item_id -> item(id).
--   idx_dif_flag_item (item_id) -- dif_flag não tem UNIQUE sobre item_id.
--   idx_item_ciclo_vida e idx_item_dominio_faceta -- nenhum é prefixo de outro.
--
-- Nota sobre a assessment_0007: o comentário dela cita idx_ipv_item como o
-- índice dedicado de item_parameter_version. Esse papel passa a ser cumprido
-- por uq_ipv_item_calibracao, cuja coluna líder também é item_id -- a invariante
-- que a 0007 defende ("toda filha de item tem item_id como coluna líder de
-- algum índice") continua valendo para as três filhas. A 0007 já foi aplicada e
-- não é editada.
--
-- Numeração: os sequenciais 0003 a 0006 estão reservados por migrations
-- posteriores desta mesma fase. A ordem real de execução vem do manifest.json,
-- não do número no nome do arquivo.
DROP INDEX IF EXISTS idx_instrument_version_instrument;
DROP INDEX IF EXISTS idx_block_instrument_version;
DROP INDEX IF EXISTS idx_block_item_block;
DROP INDEX IF EXISTS idx_ipv_item;
