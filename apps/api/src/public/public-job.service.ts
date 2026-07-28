import { Injectable } from '@nestjs/common';
import { PoolClient } from 'pg';

export interface PublicJobSummary {
  id: string;
  titulo: string;
  seoSlug: string;
  publicadoEm: Date;
}

export interface PublicJobDetail extends PublicJobSummary {
  descricao: string;
  camposCustomizados: { id: string; label: string; tipoCampo: string; faseColeta: string }[];
}

@Injectable()
export class PublicJobService {
  async listPublished(client: PoolClient, tenantId: string): Promise<PublicJobSummary[]> {
    const result = await client.query<{ id: string; titulo: string; seo_slug: string; publicado_em: Date }>(
      `SELECT id, titulo, seo_slug, publicado_em FROM job WHERE tenant_id = $1 AND publicado_em IS NOT NULL ORDER BY publicado_em DESC`,
      [tenantId],
    );
    return result.rows.map((row) => ({
      id: row.id,
      titulo: row.titulo,
      seoSlug: row.seo_slug,
      publicadoEm: row.publicado_em,
    }));
  }

  async findPublicBySlug(client: PoolClient, tenantId: string, jobSlug: string): Promise<PublicJobDetail | null> {
    const result = await client.query<{
      id: string;
      titulo: string;
      descricao: string;
      seo_slug: string;
      publicado_em: Date;
    }>(
      `SELECT id, titulo, descricao, seo_slug, publicado_em FROM job WHERE tenant_id = $1 AND seo_slug = $2 AND publicado_em IS NOT NULL`,
      [tenantId, jobSlug],
    );
    if (result.rows.length === 0) return null;
    const row = result.rows[0];

    const fields = await client.query<{ id: string; label: string; tipo_campo: string; fase_coleta: string }>(
      `SELECT id, label, tipo_campo, fase_coleta FROM job_custom_field WHERE job_id = $1`,
      [row.id],
    );

    return {
      id: row.id,
      titulo: row.titulo,
      descricao: row.descricao,
      seoSlug: row.seo_slug,
      publicadoEm: row.publicado_em,
      camposCustomizados: fields.rows.map((f) => ({
        id: f.id,
        label: f.label,
        tipoCampo: f.tipo_campo,
        faseColeta: f.fase_coleta,
      })),
    };
  }
}
