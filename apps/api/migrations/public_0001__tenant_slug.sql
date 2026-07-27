CREATE EXTENSION IF NOT EXISTS unaccent;

ALTER TABLE tenant ADD COLUMN slug text;

-- Backfill determinístico: kebab-case da razao_social + sufixo dos
-- últimos 4 caracteres do próprio id (mesma lógica de generateTenantSlug,
-- reimplementada em SQL puro porque uma migration não pode chamar código
-- TypeScript -- mantidas em sincronia deliberadamente simples: ambas fazem
-- lower+strip-accent+strip-especiais+colapsa-hifen).
UPDATE tenant
SET slug = trim(both '-' from regexp_replace(
             lower(unaccent(razao_social)), '[^a-z0-9]+', '-', 'g'
           )) || '-' || right(replace(id::text, '-', ''), 4)
WHERE slug IS NULL;

ALTER TABLE tenant ALTER COLUMN slug SET NOT NULL;
ALTER TABLE tenant ADD CONSTRAINT uq_tenant_slug UNIQUE (slug);
