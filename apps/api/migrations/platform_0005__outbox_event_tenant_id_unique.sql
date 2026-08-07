-- apps/api/migrations/platform_0005__outbox_event_tenant_id_unique.sql
--
-- Aditiva, sem efeito em nenhum consumidor existente (Trust/Insights/Resume
-- continuam lendo outbox_event exatamente como antes). Habilita a FK
-- composta (tenant_id, event_id) que webhook_delivery vai usar na Task 2 --
-- regra não-negociável do projeto para toda FK entre tabelas tenant-scoped.
-- outbox_event.id já é uuid PRIMARY KEY (unicidade global garantida); esta
-- constraint não muda cardinalidade nenhuma.
ALTER TABLE outbox_event ADD CONSTRAINT uq_outbox_event_tenant_id UNIQUE (tenant_id, id);
