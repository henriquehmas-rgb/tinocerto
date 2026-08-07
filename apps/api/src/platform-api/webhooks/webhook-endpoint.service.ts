// apps/api/src/platform-api/webhooks/webhook-endpoint.service.ts
import { Injectable } from '@nestjs/common';
import { PoolClient } from 'pg';
import { decryptWebhookSecret, encryptWebhookSecret, EncryptedSecret, generateWebhookSecret } from './webhook-secret-cipher';

const MAX_HISTORICO = 2;

export interface WebhookEndpointView {
  id: string;
  url: string;
  eventosFiltro: string[];
  segredoAtual: string; // decifrado -- ver design spec, doc 04 §6 "ver segredo ativo"
  ativo: boolean;
  criadoEm: Date;
}

@Injectable()
export class WebhookEndpointService {
  async create(client: PoolClient, input: { tenantId: string; url: string; eventosFiltro: string[] }): Promise<WebhookEndpointView> {
    const rawSecret = generateWebhookSecret();
    const cifrado = encryptWebhookSecret(rawSecret);
    const result = await client.query<{ id: string; criado_em: Date }>(
      `INSERT INTO webhook_endpoint (tenant_id, url, eventos_filtro, segredo_atual_cifrado)
       VALUES ($1, $2, $3, $4) RETURNING id, criado_em`,
      [input.tenantId, input.url, input.eventosFiltro, JSON.stringify(cifrado)],
    );
    return {
      id: result.rows[0].id,
      url: input.url,
      eventosFiltro: input.eventosFiltro,
      segredoAtual: rawSecret,
      ativo: true,
      criadoEm: result.rows[0].criado_em,
    };
  }

  async list(client: PoolClient): Promise<WebhookEndpointView[]> {
    const result = await client.query<{
      id: string; url: string; eventos_filtro: string[]; segredo_atual_cifrado: EncryptedSecret; ativo: boolean; criado_em: Date;
    }>(`SELECT id, url, eventos_filtro, segredo_atual_cifrado, ativo, criado_em FROM webhook_endpoint ORDER BY criado_em`);
    return result.rows.map((row) => ({
      id: row.id,
      url: row.url,
      eventosFiltro: row.eventos_filtro,
      segredoAtual: decryptWebhookSecret(row.segredo_atual_cifrado),
      ativo: row.ativo,
      criadoEm: row.criado_em,
    }));
  }

  async update(client: PoolClient, id: string, input: { url?: string; eventosFiltro?: string[] }): Promise<void> {
    await client.query(
      `UPDATE webhook_endpoint SET url = COALESCE($2, url), eventos_filtro = COALESCE($3, eventos_filtro) WHERE id = $1`,
      [id, input.url ?? null, input.eventosFiltro ?? null],
    );
  }

  async deactivate(client: PoolClient, id: string): Promise<void> {
    await client.query(`UPDATE webhook_endpoint SET ativo = false WHERE id = $1`, [id]);
  }

  // Move o segredo atual para o histórico (cap MAX_HISTORICO -- descarta o
  // mais antigo além do limite, ver design spec decisão 17), gera um novo.
  async rotateSecret(client: PoolClient, id: string): Promise<{ segredoAtual: string }> {
    const atual = await client.query<{ segredo_atual_cifrado: EncryptedSecret; segredos_historico_cifrados: EncryptedSecret[] }>(
      `SELECT segredo_atual_cifrado, segredos_historico_cifrados FROM webhook_endpoint WHERE id = $1`,
      [id],
    );
    const novoRaw = generateWebhookSecret();
    const novoCifrado = encryptWebhookSecret(novoRaw);
    const novoHistorico = [atual.rows[0].segredo_atual_cifrado, ...atual.rows[0].segredos_historico_cifrados].slice(0, MAX_HISTORICO);

    await client.query(
      `UPDATE webhook_endpoint SET segredo_atual_cifrado = $2, segredos_historico_cifrados = $3 WHERE id = $1`,
      [id, JSON.stringify(novoCifrado), novoHistorico.map((h) => JSON.stringify(h))],
    );
    return { segredoAtual: novoRaw };
  }
}
