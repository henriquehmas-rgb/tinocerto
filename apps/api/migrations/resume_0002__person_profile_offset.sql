-- Sem alteração estrutural na coluna (continua jsonb) -- os itens de
-- experiencias/formacao/habilidades passam a incluir offsetInicio/offsetFim
-- opcionais dentro de cada objeto do array, escritos pelo
-- ResumeParsingConsumer. Nenhuma migration de schema é necessária para
-- isso (jsonb já aceita qualquer forma) -- esta migration existe só para
-- documentar a mudança de contrato de dado com um comentário versionado.
COMMENT ON COLUMN person_profile.experiencias IS 'Array de {cargo, empresa, periodo, descricao, citacaoVerbatim, offsetInicio?, offsetFim?}';
COMMENT ON COLUMN person_profile.formacao IS 'Array de {curso, instituicao, periodo, citacaoVerbatim, offsetInicio?, offsetFim?}';
COMMENT ON COLUMN person_profile.habilidades IS 'Array de {nome, citacaoVerbatim, offsetInicio?, offsetFim?}';
