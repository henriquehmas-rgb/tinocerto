-- Banco inicial: 40 itens contextualizados ao trabalho, derivados do pool
-- público do IPIP, 8 por domínio Big Five, valência balanceada 4 positivos /
-- 4 negativos por domínio. TODOS entram como pre_teste, com parâmetros
-- PROVISÓRIOS de literatura (a ~ 0,9-1,5; b ~ -1,5 a +1,5) -- nada aqui é
-- calibrado, e é exatamente por isso que o CAT fica travado (Task 10).
--
-- Vocabulário: descrição de COMPORTAMENTO no trabalho, nunca de sintoma,
-- humor ou condição de saúde. Os itens de estabilidade em particular falam
-- de reação a pressão de trabalho, não de estado afetivo -- o instrumento é
-- comportamental não-psicológico (Res. CFP 31/2022).

CREATE TEMP TABLE seed_item (
  enunciado text,
  dominio   text,
  faceta    text,
  valencia  text,
  a         numeric,
  b         numeric
) ON COMMIT DROP;

INSERT INTO seed_item (enunciado, dominio, faceta, valencia, a, b) VALUES
-- Conscienciosidade
('No trabalho, eu planejo minhas tarefas com antecedência.',              'conscienciosidade', 'ordem',        'positivo', 1.30, -0.60),
('No trabalho, eu reviso o que entrego antes de dar por concluído.',      'conscienciosidade', 'zelo',         'positivo', 1.25, -0.30),
('No trabalho, eu cumpro prazos mesmo quando ninguém está cobrando.',     'conscienciosidade', 'autodisciplina','positivo', 1.40,  0.10),
('No trabalho, eu mantenho meus registros e arquivos organizados.',       'conscienciosidade', 'ordem',        'positivo', 1.10, -0.20),
('No trabalho, eu deixo tarefas pela metade quando surge algo novo.',     'conscienciosidade', 'autodisciplina','negativo', 1.20,  0.30),
('No trabalho, eu adio atividades que considero chatas.',                 'conscienciosidade', 'autodisciplina','negativo', 1.15,  0.00),
('No trabalho, eu perco prazos por me organizar mal.',                    'conscienciosidade', 'ordem',        'negativo', 1.35,  0.70),
('No trabalho, eu entrego sem conferir os detalhes.',                     'conscienciosidade', 'zelo',         'negativo', 1.05,  0.40),
-- Extroversão
('No trabalho, eu puxo conversa com pessoas que ainda não conheço.',      'extroversao', 'sociabilidade', 'positivo', 1.30, -0.10),
('No trabalho, eu me ofereço para apresentar resultados ao grupo.',       'extroversao', 'assertividade', 'positivo', 1.35,  0.40),
('No trabalho, eu assumo a condução quando a reunião trava.',             'extroversao', 'assertividade', 'positivo', 1.25,  0.60),
('No trabalho, eu circulo entre as áreas para trocar ideia.',             'extroversao', 'sociabilidade', 'positivo', 1.10, -0.30),
('No trabalho, eu prefiro tarefas que faço sozinho.',                     'extroversao', 'sociabilidade', 'negativo', 1.20, -0.20),
('No trabalho, eu fico calado em reuniões grandes.',                      'extroversao', 'assertividade', 'negativo', 1.30,  0.10),
('No trabalho, eu evito puxar assunto no intervalo.',                     'extroversao', 'sociabilidade', 'negativo', 1.15,  0.30),
('No trabalho, eu deixo que outros conduzam as discussões.',              'extroversao', 'assertividade', 'negativo', 1.05,  0.00),
-- Amabilidade
('No trabalho, eu paro o que estou fazendo para ajudar um colega.',       'amabilidade', 'cooperacao', 'positivo', 1.25, -0.50),
('No trabalho, eu procuro entender o lado do outro antes de discordar.',  'amabilidade', 'empatia',    'positivo', 1.30, -0.20),
('No trabalho, eu divido o crédito de um resultado com o time.',          'amabilidade', 'cooperacao', 'positivo', 1.20, -0.40),
('No trabalho, eu dou retorno difícil com cuidado para não desmotivar.',  'amabilidade', 'empatia',    'positivo', 1.10,  0.20),
('No trabalho, eu falo o que penso sem medir como o outro recebe.',       'amabilidade', 'empatia',    'negativo', 1.25,  0.30),
('No trabalho, eu defendo minha posição mesmo desgastando a relação.',    'amabilidade', 'cooperacao', 'negativo', 1.15,  0.50),
('No trabalho, eu acho que a maioria só age por interesse próprio.',      'amabilidade', 'confianca',  'negativo', 1.30,  0.60),
('No trabalho, eu resisto a mudar de ideia numa discussão.',              'amabilidade', 'cooperacao', 'negativo', 1.05,  0.10),
-- Estabilidade emocional (redigido como reação a pressão de TRABALHO)
('No trabalho, eu mantenho a calma quando o prazo aperta.',               'estabilidade', 'serenidade',  'positivo', 1.40, -0.20),
('No trabalho, eu retomo o ritmo rápido depois de um contratempo.',       'estabilidade', 'resiliencia', 'positivo', 1.30,  0.00),
('No trabalho, eu recebo crítica sem que isso atrapalhe minha entrega.',  'estabilidade', 'resiliencia', 'positivo', 1.25,  0.30),
('No trabalho, eu decido bem mesmo sob pressão.',                         'estabilidade', 'serenidade',  'positivo', 1.35,  0.50),
('No trabalho, eu me irrito quando mudam minhas prioridades.',            'estabilidade', 'serenidade',  'negativo', 1.20,  0.10),
('No trabalho, eu levo muito tempo para superar um erro que cometi.',     'estabilidade', 'resiliencia', 'negativo', 1.30,  0.40),
('No trabalho, eu fico tenso quando o volume de demandas aumenta.',       'estabilidade', 'serenidade',  'negativo', 1.15, -0.10),
('No trabalho, eu reajo mal a um retorno negativo.',                      'estabilidade', 'resiliencia', 'negativo', 1.10,  0.20),
-- Abertura
('No trabalho, eu proponho formas diferentes de resolver um problema.',   'abertura', 'criatividade', 'positivo', 1.35, -0.10),
('No trabalho, eu procuro aprender ferramentas que ainda não domino.',    'abertura', 'aprendizado',  'positivo', 1.30, -0.40),
('No trabalho, eu me interesso por áreas fora da minha função.',          'abertura', 'aprendizado',  'positivo', 1.20,  0.10),
('No trabalho, eu questiono processos que sempre foram feitos assim.',    'abertura', 'criatividade', 'positivo', 1.25,  0.30),
('No trabalho, eu prefiro seguir o método já conhecido.',                 'abertura', 'criatividade', 'negativo', 1.30,  0.00),
('No trabalho, eu evito tarefas que exigem aprender algo novo.',          'abertura', 'aprendizado',  'negativo', 1.35,  0.50),
('No trabalho, eu acho perda de tempo discutir formas alternativas.',     'abertura', 'criatividade', 'negativo', 1.15,  0.40),
('No trabalho, eu me incomodo quando mudam o processo estabelecido.',     'abertura', 'aprendizado',  'negativo', 1.05,  0.20);

-- Insere os itens em pre_teste.
INSERT INTO item (enunciado, dominio, faceta, chave_valencia, ciclo_vida)
SELECT enunciado, dominio, faceta, valencia, 'pre_teste' FROM seed_item;

-- Parâmetros PROVISÓRIOS de literatura -- nada calibrado.
INSERT INTO item_parameter_version (item_id, modelo, a, b, c, calibracao_versao, provisorio, amostra_n)
SELECT i.id, '2PL', s.a, s.b, 0, 'literatura_v1', true, 0
  FROM item i
  JOIN seed_item s ON s.enunciado = i.enunciado;

-- Instrumento inicial, em modo LINEAR (decisão de bootstrap desta fase).
INSERT INTO instrument (id, nome) VALUES
  ('a55e55e0-0000-4000-8000-000000000001', 'Perfil Comportamental Tinocerto');

INSERT INTO instrument_version (id, instrument_id, versao, modo_administracao, ativo) VALUES
  ('a55e55e0-0000-4000-8000-000000000002', 'a55e55e0-0000-4000-8000-000000000001', 1, 'linear', true);

-- 20 blocos de 2 itens, cada bloco pareando um POSITIVO com um NEGATIVO do
-- MESMO domínio -- o chaveamento oposto que o gate da Task 3 exige e que é o
-- que quebra a ipsatividade.
DO $$
DECLARE
  dom text;
  ordem_global integer := 0;
  positivos uuid[];
  negativos uuid[];
  i integer;
  novo_bloco uuid;
BEGIN
  FOREACH dom IN ARRAY ARRAY['conscienciosidade','extroversao','amabilidade','estabilidade','abertura'] LOOP
    SELECT array_agg(id ORDER BY enunciado) INTO positivos
      FROM item WHERE dominio = dom AND chave_valencia = 'positivo';
    SELECT array_agg(id ORDER BY enunciado) INTO negativos
      FROM item WHERE dominio = dom AND chave_valencia = 'negativo';

    FOR i IN 1..array_length(positivos, 1) LOOP
      ordem_global := ordem_global + 1;
      INSERT INTO block (instrument_version_id, ordem)
        VALUES ('a55e55e0-0000-4000-8000-000000000002', ordem_global)
        RETURNING id INTO novo_bloco;
      INSERT INTO block_item (block_id, item_id, posicao) VALUES (novo_bloco, positivos[i], 1);
      INSERT INTO block_item (block_id, item_id, posicao) VALUES (novo_bloco, negativos[i], 2);
    END LOOP;
  END LOOP;
END
$$;
