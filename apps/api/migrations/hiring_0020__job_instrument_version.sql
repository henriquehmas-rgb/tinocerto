-- Vínculo vaga->instrumento de assessment (Fase "assessment do candidato"):
-- qual banco de itens usar quando o candidato se candidata a esta vaga.
-- Nullable -- vaga sem instrumento configurado nunca dispara assessment
-- automático, comportamento de hoje se mantém. instrument_version é
-- GLOBAL (sem tenant_id, ver instrument_0001), então esta FK não precisa
-- de coluna composta.
ALTER TABLE job ADD COLUMN instrument_version_id uuid REFERENCES instrument_version(id);
