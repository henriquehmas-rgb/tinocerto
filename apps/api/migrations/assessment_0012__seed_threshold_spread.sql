-- Espalha os limiares efetivos dos 20 blocos MFC pela escala de θ.
--
-- DEFEITO CORRIGIDO (fix round 1 da Task 8). Num bloco de chaveamento oposto
-- a diferença de utilidade entre o polo positivo e o negativo é
--
--     u(pos) - u(neg) = a+ (θ - b+) + a- (θ - b-)
--                     = (a+ + a-) θ - (a+ b+ + a- b-)
--
-- ou seja o bloco é 50/50 no limiar efetivo
--
--     L = (a+ b+ + a- b-) / (a+ + a-)
--
-- que é a MÉDIA PONDERADA das duas dificuldades, não a diferença delas. A
-- assessment_0005 escolheu `b` item a item e pareou os blocos por ordem
-- alfabética de enunciado, sem controle nenhum sobre a combinação resultante.
-- O efeito medido sobre os 20 blocos vivos: TODO L caiu em [-0,153; +0,353],
-- uma faixa de 0,5 ponto em torno de θ ≈ 0,1. Um domínio (estabilidade) tinha
-- amplitude de 0,135 -- os quatro blocos praticamente empilhados no mesmo
-- ponto da escala.
--
-- A consequência, medida com o estimador real sobre os parâmetros reais e o
-- respondente modal: θ verdadeiro -2, -1,5, -1 e -0,5 devolviam TODOS o mesmo
-- θ estimado (~ -1,05), e +0,5, +1, +1,5 e +2 devolviam todos ~ +1,19. Fora
-- da faixa estreita o instrumento não ordena candidato nenhum -- que é
-- exatamente o que ele existe para fazer. Não é imprecisão: é ausência de
-- informação, porque um bloco só informa perto do próprio L.
--
-- É o mesmo modo de falha que o comentário SEPARACAO_DIFICULDADE da
-- parameter-recovery.spec.ts documenta: com os polos escolhidos de forma
-- espelhada (ou, aqui, arbitrária), o termo de dificuldade colapsa.
--
-- DESENHO QUE SUBSTITUI. Os dois polos do bloco andam NA MESMA DIREÇÃO em
-- torno de um limiar-alvo L, com meia-distância s = 0,50:
--
--     b+ = L + s      b- = L - s
--
-- de modo que L_efetivo = L + s (a+ - a-)/(a+ + a-) ≈ L (o desvio é ~0,03
-- com os `a` deste banco). Cada domínio recebe quatro blocos em
-- L ∈ {-1,00; -0,35; +0,35; +1,00}, e o `b` resultante varre exatamente
-- -1,50 a +1,50 -- a faixa que o cabeçalho da 0005 sempre afirmou e que o
-- dado dela nunca cumpriu (o `b` real ia só de -0,60 a +0,70).
--
-- Dentro de cada domínio o slot é escolhido pelo CONTEÚDO do item, que é o
-- que `b` significa: o item positivo mais fácil de endossar vai para o slot
-- de L mais baixo e o mais exigente para o de L mais alto; o item negativo
-- mais extremo (endossado só por quem está bem embaixo na escala) vai para o
-- slot de L mais baixo e o mais banal para o de L mais alto. O PAREAMENTO do
-- bloco passa a ser deliberado, e não subproduto da ordem alfabética -- e
-- pareamento, ao contrário de `a`/`b`, SOBREVIVE à recalibração.
--
-- `a` não muda: é o parâmetro com lastro de literatura de verdade, continua
-- em 1,05-1,40, e continua PROVISÓRIO como tudo aqui. Nada nesta migration é
-- calibração; o CAT segue travado (Task 10) até uma calibration_run real.
--
-- IDEMPOTÊNCIA / CONVERGÊNCIA. Esta migration determina sozinha o estado
-- final de `b` e da composição dos blocos, então banco novo (0005 depois
-- 0012) e banco que já tinha a 0005 aplicada terminam idênticos. Ela é
-- escopada pelo instrument_version conhecido e nunca varre `item` inteira.

--
-- SOBRESCRITA NUMA TABELA DECLARADA APPEND-ONLY -- por que é seguro AQUI e
-- por que não pode virar precedente.
--
-- A assessment_0001 declara, logo acima de item_parameter_version:
-- "Parâmetros VERSIONADOS: recalibrar cria linha nova, nunca sobrescreve."
-- O UPDATE de `b` abaixo viola essa regra ao pé da letra: a linha rotulada
-- `literatura_v1` passa a valer um `b` diferente do que `literatura_v1`
-- significava quando a 0005 a gravou, e não sobra rastro do valor antigo.
--
-- É seguro exatamente porque NADA foi escorado ainda: item_response e
-- assessment_result estão vazias (0 linhas, conferido no banco antes de
-- escrever esta migration). Não existe theta cujo
-- assessment_result.calibracao_versao = 'literatura_v1' deixasse de
-- identificar os parâmetros que o produziram. Também não há histórico a
-- preservar: `literatura_v1` nunca foi calibração -- é chute de literatura,
-- provisorio = true -- e a 0005 que o gravou e esta que o corrige são a MESMA
-- intenção de seed, entregue em duas migrations.
--
-- E o caminho append seria PIOR hoje: uq_ipv_item_calibracao UNIQUE
-- (item_id, calibracao_versao) obriga um rótulo novo para uma linha nova, e
-- não existe coluna `vigente` nem regra nenhuma de seleção de versão no
-- repositório -- todo leitor de parâmetro é um `JOIN item_parameter_version p
-- ... AND p.calibracao_versao = 'literatura_v1'` literal. Uma segunda linha
-- por item duplicaria silenciosamente cada item em todos esses consumidores.
--
-- REGRA A PARTIR DA PRIMEIRA item_response: esta é a ÚLTIMA migration
-- autorizada a reescrever parâmetro no lugar. Depois que existir resposta
-- gravada, mudar `a`/`b` exige (1) INSERT de uma calibracao_versao NOVA,
-- (2) uma regra explícita de qual versão é a vigente, e (3) que
-- assessment_result.calibracao_versao continue apontando para a versão que de
-- fato gerou aquele theta. Reescrever no lugar dali em diante invalida em
-- silêncio resultado já entregue a tenant.

-- Estado-alvo: enunciado -> (domínio, valência, slot do bloco, b).
CREATE TEMP TABLE seed_alvo (
  enunciado text PRIMARY KEY,
  dominio   text NOT NULL,
  valencia  text NOT NULL,
  slot      integer NOT NULL,
  b         numeric NOT NULL,
  UNIQUE (dominio, valencia, slot)
) ON COMMIT DROP;

-- b+ = L + 0,50 / b- = L - 0,50, com L = -1,00 / -0,35 / +0,35 / +1,00.
INSERT INTO seed_alvo (enunciado, dominio, valencia, slot, b) VALUES
-- Conscienciosidade
('No trabalho, eu planejo minhas tarefas com antecedência.',              'conscienciosidade', 'positivo', 1, -0.50),
('No trabalho, eu mantenho meus registros e arquivos organizados.',       'conscienciosidade', 'positivo', 2,  0.15),
('No trabalho, eu reviso o que entrego antes de dar por concluído.',      'conscienciosidade', 'positivo', 3,  0.85),
('No trabalho, eu cumpro prazos mesmo quando ninguém está cobrando.',     'conscienciosidade', 'positivo', 4,  1.50),
('No trabalho, eu perco prazos por me organizar mal.',                    'conscienciosidade', 'negativo', 1, -1.50),
('No trabalho, eu entrego sem conferir os detalhes.',                     'conscienciosidade', 'negativo', 2, -0.85),
('No trabalho, eu deixo tarefas pela metade quando surge algo novo.',     'conscienciosidade', 'negativo', 3, -0.15),
('No trabalho, eu adio atividades que considero chatas.',                 'conscienciosidade', 'negativo', 4,  0.50),
-- Extroversão
('No trabalho, eu circulo entre as áreas para trocar ideia.',             'extroversao', 'positivo', 1, -0.50),
('No trabalho, eu puxo conversa com pessoas que ainda não conheço.',      'extroversao', 'positivo', 2,  0.15),
('No trabalho, eu me ofereço para apresentar resultados ao grupo.',       'extroversao', 'positivo', 3,  0.85),
('No trabalho, eu assumo a condução quando a reunião trava.',             'extroversao', 'positivo', 4,  1.50),
('No trabalho, eu evito puxar assunto no intervalo.',                     'extroversao', 'negativo', 1, -1.50),
('No trabalho, eu fico calado em reuniões grandes.',                      'extroversao', 'negativo', 2, -0.85),
('No trabalho, eu prefiro tarefas que faço sozinho.',                     'extroversao', 'negativo', 3, -0.15),
('No trabalho, eu deixo que outros conduzam as discussões.',              'extroversao', 'negativo', 4,  0.50),
-- Amabilidade
('No trabalho, eu divido o crédito de um resultado com o time.',          'amabilidade', 'positivo', 1, -0.50),
('No trabalho, eu paro o que estou fazendo para ajudar um colega.',       'amabilidade', 'positivo', 2,  0.15),
('No trabalho, eu procuro entender o lado do outro antes de discordar.',  'amabilidade', 'positivo', 3,  0.85),
('No trabalho, eu dou retorno difícil com cuidado para não desmotivar.',  'amabilidade', 'positivo', 4,  1.50),
('No trabalho, eu acho que a maioria só age por interesse próprio.',      'amabilidade', 'negativo', 1, -1.50),
('No trabalho, eu defendo minha posição mesmo desgastando a relação.',    'amabilidade', 'negativo', 2, -0.85),
('No trabalho, eu falo o que penso sem medir como o outro recebe.',       'amabilidade', 'negativo', 3, -0.15),
('No trabalho, eu resisto a mudar de ideia numa discussão.',              'amabilidade', 'negativo', 4,  0.50),
-- Estabilidade (reação a pressão de TRABALHO, nunca estado afetivo)
('No trabalho, eu retomo o ritmo rápido depois de um contratempo.',       'estabilidade', 'positivo', 1, -0.50),
('No trabalho, eu mantenho a calma quando o prazo aperta.',               'estabilidade', 'positivo', 2,  0.15),
('No trabalho, eu recebo crítica sem que isso atrapalhe minha entrega.',  'estabilidade', 'positivo', 3,  0.85),
('No trabalho, eu decido bem mesmo sob pressão.',                         'estabilidade', 'positivo', 4,  1.50),
('No trabalho, eu levo muito tempo para superar um erro que cometi.',     'estabilidade', 'negativo', 1, -1.50),
('No trabalho, eu reajo mal a um retorno negativo.',                      'estabilidade', 'negativo', 2, -0.85),
('No trabalho, eu me irrito quando mudam minhas prioridades.',            'estabilidade', 'negativo', 3, -0.15),
('No trabalho, eu fico tenso quando o volume de demandas aumenta.',       'estabilidade', 'negativo', 4,  0.50),
-- Abertura
('No trabalho, eu procuro aprender ferramentas que ainda não domino.',    'abertura', 'positivo', 1, -0.50),
('No trabalho, eu proponho formas diferentes de resolver um problema.',   'abertura', 'positivo', 2,  0.15),
('No trabalho, eu me interesso por áreas fora da minha função.',          'abertura', 'positivo', 3,  0.85),
('No trabalho, eu questiono processos que sempre foram feitos assim.',    'abertura', 'positivo', 4,  1.50),
('No trabalho, eu evito tarefas que exigem aprender algo novo.',          'abertura', 'negativo', 1, -1.50),
('No trabalho, eu acho perda de tempo discutir formas alternativas.',     'abertura', 'negativo', 2, -0.85),
('No trabalho, eu me incomodo quando mudam o processo estabelecido.',     'abertura', 'negativo', 3, -0.15),
('No trabalho, eu prefiro seguir o método já conhecido.',                 'abertura', 'negativo', 4,  0.50);

-- Slot (domínio, 1..4) -> ordem 1..20 do bloco. Mesma numeração que a 0005
-- já criou, então nenhum `block` precisa ser criado nem removido aqui.
CREATE TEMP TABLE seed_bloco (
  ordem   integer PRIMARY KEY,
  dominio text NOT NULL,
  slot    integer NOT NULL,
  UNIQUE (dominio, slot)
) ON COMMIT DROP;

INSERT INTO seed_bloco (ordem, dominio, slot) VALUES
  ( 1, 'conscienciosidade', 1), ( 2, 'conscienciosidade', 2),
  ( 3, 'conscienciosidade', 3), ( 4, 'conscienciosidade', 4),
  ( 5, 'extroversao',       1), ( 6, 'extroversao',       2),
  ( 7, 'extroversao',       3), ( 8, 'extroversao',       4),
  ( 9, 'amabilidade',       1), (10, 'amabilidade',       2),
  (11, 'amabilidade',       3), (12, 'amabilidade',       4),
  (13, 'estabilidade',      1), (14, 'estabilidade',      2),
  (15, 'estabilidade',      3), (16, 'estabilidade',      4),
  (17, 'abertura',          1), (18, 'abertura',          2),
  (19, 'abertura',          3), (20, 'abertura',          4);

-- Os itens do seed, achados pela ÚNICA via escopada que existe: pertencer a
-- um bloco do instrument_version conhecido. Nada de varrer `item` por
-- banco_id ou por enunciado -- `item` é global e outros specs escrevem nela.
CREATE TEMP TABLE seed_item_atual ON COMMIT DROP AS
SELECT DISTINCT bi.item_id, i.enunciado
  FROM block_item bi
  JOIN block b ON b.id = bi.block_id
  JOIN item i ON i.id = bi.item_id
 WHERE b.instrument_version_id = 'a55e55e0-0000-4000-8000-000000000002';

-- Guarda: se o banco vivo não for exatamente os 40 itens que este desenho
-- descreve, ABORTA em vez de reescrever meio instrumento em silêncio.
DO $fix$
DECLARE
  n_itens    integer;
  n_casados  integer;
  n_blocos   integer;
BEGIN
  SELECT count(*) INTO n_itens FROM seed_item_atual;
  SELECT count(*) INTO n_casados
    FROM seed_item_atual m JOIN seed_alvo alvo ON alvo.enunciado = m.enunciado;
  SELECT count(*) INTO n_blocos
    FROM block WHERE instrument_version_id = 'a55e55e0-0000-4000-8000-000000000002';

  IF n_itens <> 40 OR n_casados <> 40 OR n_blocos <> 20 THEN
    RAISE EXCEPTION
      'seed inesperado: % itens no instrumento, % casados com o alvo, % blocos (esperado 40/40/20)',
      n_itens, n_casados, n_blocos;
  END IF;
END
$fix$;

-- (1) Reescreve APENAS `b`. `a` e todo o resto da linha de parâmetro ficam.
UPDATE item_parameter_version p
   SET b = alvo.b
  FROM seed_item_atual m
  JOIN seed_alvo alvo ON alvo.enunciado = m.enunciado
 WHERE p.item_id = m.item_id
   AND p.calibracao_versao = 'literatura_v1';

-- (2) Repareia os blocos. DELETE + INSERT na MESMA transação: o gate de
-- chaveamento oposto (assessment_0010, CONSTRAINT TRIGGER DEFERRABLE
-- INITIALLY DEFERRED) só cobra no COMMIT, e bloco vazio é estado legítimo no
-- meio do caminho -- então a validação vê os 20 blocos já remontados, cada um
-- com 1 positivo e 1 negativo.
DELETE FROM block_item bi
 USING block b
 WHERE bi.block_id = b.id
   AND b.instrument_version_id = 'a55e55e0-0000-4000-8000-000000000002';

INSERT INTO block_item (block_id, item_id, posicao)
SELECT bl.id,
       m.item_id,
       CASE WHEN alvo.valencia = 'positivo' THEN 1 ELSE 2 END
  FROM seed_alvo alvo
  JOIN seed_item_atual m ON m.enunciado = alvo.enunciado
  JOIN seed_bloco sb ON sb.dominio = alvo.dominio AND sb.slot = alvo.slot
  JOIN block bl ON bl.instrument_version_id = 'a55e55e0-0000-4000-8000-000000000002'
               AND bl.ordem = sb.ordem;
