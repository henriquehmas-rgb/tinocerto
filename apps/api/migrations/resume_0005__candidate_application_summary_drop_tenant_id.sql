-- [Achado do gate consolidado da Fase 1b, Task 18] A migration original
-- (resume_0003__candidate_application_summary.sql, Task 14) já documentava
-- em comentário que candidate_application_summary é "global de propósito
-- (sem tenant_id, mesma classe de person/resume_upload)" -- mesma classe
-- listada em GLOBAL_TABLES_SEM_TENANT_ID no gate -- mas a própria DDL
-- daquela migration criava a coluna tenant_id NOT NULL mesmo assim,
-- contradição entre o comentário e o código nunca pega por nenhuma
-- revisão task-a-task isolada. A coluna nunca foi lida de volta em
-- nenhum SELECT do produto (CandidateApplicationController.listMyApplications
-- filtra só por person_id; o consumer só usa application_id nos UPDATEs) --
-- só era escrita nos INSERTs, sem nenhum uso. Removendo aqui, no mesmo
-- espírito retroativo de org_graph_0002__org_unit_parent_composite_fk.sql:
-- corrigir o esquema quando o gate de fim de fase encontra a divergência,
-- em vez de deixar uma coluna morta e um comentário mentiroso no schema.
ALTER TABLE candidate_application_summary DROP CONSTRAINT candidate_application_summary_tenant_id_fkey;

ALTER TABLE candidate_application_summary DROP COLUMN tenant_id;
