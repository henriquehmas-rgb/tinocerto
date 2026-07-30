-- Banco de itens: GLOBAL de propósito (sem tenant_id), mesma classe de
-- person/assessment_result. O item é ativo da plataforma; é a agregação de
-- respostas de MÚLTIPLOS tenants que torna a calibração possível. Não é RLS
-- esquecida -- ver spec da Fase 2a.
CREATE TABLE item (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  banco_id       text NOT NULL DEFAULT 'ipip_contextualizado',
  enunciado      text NOT NULL,
  dominio        text NOT NULL,
  faceta         text,
  -- positivo: concordar indica MAIS do traço. negativo: concordar indica MENOS.
  -- Chaveamento oposto dentro do bloco MFC é o que quebra a ipsatividade.
  chave_valencia text NOT NULL CHECK (chave_valencia IN ('positivo', 'negativo')),
  ciclo_vida     text NOT NULL DEFAULT 'rascunho'
                 CHECK (ciclo_vida IN ('rascunho', 'pre_teste', 'calibrado', 'ativo', 'aposentado')),
  taxa_exposicao numeric(5,4) NOT NULL DEFAULT 0,
  criado_em      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_item_dominio_faceta ON item (dominio, faceta);
CREATE INDEX idx_item_ciclo_vida ON item (ciclo_vida);

GRANT SELECT, INSERT, UPDATE ON item TO app_runtime;

-- Parâmetros VERSIONADOS: recalibrar cria linha nova, nunca sobrescreve.
-- provisorio = parâmetro derivado de literatura, não de calibração sobre
-- dados reais. É o gate que trava o CAT (Task 10): enquanto houver
-- provisório, o motor adaptativo não pode ser ativado.
CREATE TABLE item_parameter_version (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  item_id           uuid NOT NULL REFERENCES item(id),
  modelo            text NOT NULL CHECK (modelo IN ('1PL', '2PL', '3PL', 'GRM')),
  a                 numeric(8,5) NOT NULL,
  b                 numeric(8,5) NOT NULL,
  c                 numeric(8,5) NOT NULL DEFAULT 0,
  calibracao_versao text NOT NULL,
  amostra_n         integer NOT NULL DEFAULT 0,
  provisorio        boolean NOT NULL DEFAULT true,
  calibrado_em      timestamptz,
  criado_em         timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_ipv_item_calibracao UNIQUE (item_id, calibracao_versao)
);

CREATE INDEX idx_ipv_item ON item_parameter_version (item_id);
CREATE INDEX idx_ipv_provisorio ON item_parameter_version (provisorio);

GRANT SELECT, INSERT, UPDATE ON item_parameter_version TO app_runtime;

-- Funcionamento diferencial de item (DIF): marca item que se comporta
-- diferente entre grupos com o mesmo theta. Alimenta a revisão do banco;
-- nunca é usado para decisão sobre candidato.
CREATE TABLE dif_flag (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  item_id      uuid NOT NULL REFERENCES item(id),
  grupo        text NOT NULL,
  metodo       text NOT NULL,
  magnitude    numeric(8,5) NOT NULL,
  detectado_em timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_dif_flag_item ON dif_flag (item_id);

GRANT SELECT, INSERT ON dif_flag TO app_runtime;
