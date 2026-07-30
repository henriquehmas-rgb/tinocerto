-- Dois trilhos no schema desde o dia 1 (decisão de base, doc 02):
--   nao_psicologico          -> ATIVO nesta fase
--   teste_psicologico_satepsi -> presente, porém travado (Task 3): exige CRP
--                                ativo para ser ativado. Existe agora para que
--                                um registro formal futuro seja preencher
--                                formulário, não reconstruir produto.
CREATE TABLE instrument (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nome             text NOT NULL,
  tipo_instrumento text NOT NULL DEFAULT 'nao_psicologico'
                   CHECK (tipo_instrumento IN ('nao_psicologico', 'teste_psicologico_satepsi')),
  criado_em        timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE ON instrument TO app_runtime;

CREATE TABLE instrument_version (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  instrument_id       uuid NOT NULL REFERENCES instrument(id),
  versao              integer NOT NULL,
  -- linear: todo candidato responde a forma completa. É o modo do dia 1 --
  -- ver decisão de bootstrap na spec: CAT sobre parâmetros provisórios
  -- seleciona itens errados E contamina os dados da própria calibração.
  modo_administracao  text NOT NULL DEFAULT 'linear'
                      CHECK (modo_administracao IN ('linear', 'cat')),
  -- Critérios de parada, só usados quando modo_administracao = 'cat'.
  se_alvo             numeric(5,3) NOT NULL DEFAULT 0.300,
  teto_itens          integer NOT NULL DEFAULT 60,
  teto_segundos       integer NOT NULL DEFAULT 3600,
  ativo               boolean NOT NULL DEFAULT false,
  criado_em           timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_instrument_version UNIQUE (instrument_id, versao)
);

CREATE INDEX idx_instrument_version_instrument ON instrument_version (instrument_id);

GRANT SELECT, INSERT, UPDATE ON instrument_version TO app_runtime;

-- Bloco MFC: 2 a 4 itens apresentados juntos, o candidato escolhe o mais e o
-- menos característico. A cardinalidade é imposta na Task 3 (trigger), porque
-- CHECK não consegue contar linhas de outra tabela.
CREATE TABLE block (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  instrument_version_id uuid NOT NULL REFERENCES instrument_version(id),
  ordem                integer NOT NULL,
  criado_em            timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_block_ordem UNIQUE (instrument_version_id, ordem)
);

CREATE INDEX idx_block_instrument_version ON block (instrument_version_id);

GRANT SELECT, INSERT, UPDATE ON block TO app_runtime;

CREATE TABLE block_item (
  id        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  block_id  uuid NOT NULL REFERENCES block(id),
  item_id   uuid NOT NULL REFERENCES item(id),
  posicao   integer NOT NULL,
  CONSTRAINT uq_block_item UNIQUE (block_id, item_id),
  CONSTRAINT uq_block_posicao UNIQUE (block_id, posicao)
);

CREATE INDEX idx_block_item_block ON block_item (block_id);

GRANT SELECT, INSERT, DELETE ON block_item TO app_runtime;
