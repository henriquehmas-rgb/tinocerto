// apps/api/src/platform-api/webhooks/webhook-endpoint.service.ts
import { Injectable, NotFoundException } from '@nestjs/common';
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

  // Busca de um único endpoint por id -- mesma projeção decifrada de list(),
  // ver design spec §10 (GET :id). RLS filtra id inexistente/de outro tenant
  // para 0 linhas silenciosamente (CerbosGuard nunca confirma posse real --
  // monta resource.attr.tenant_id do REQUISITANTE, não do recurso -- ver
  // achado da revisão de código), então o 404 explícito abaixo é a única
  // barreira real para esse caso.
  async get(client: PoolClient, id: string): Promise<WebhookEndpointView> {
    const result = await client.query<{
      id: string; url: string; eventos_filtro: string[]; segredo_atual_cifrado: EncryptedSecret; ativo: boolean; criado_em: Date;
    }>(`SELECT id, url, eventos_filtro, segredo_atual_cifrado, ativo, criado_em FROM webhook_endpoint WHERE id = $1`, [id]);
    if (result.rows.length === 0) {
      throw new NotFoundException('Endpoint de webhook não encontrado');
    }
    const row = result.rows[0];
    return {
      id: row.id,
      url: row.url,
      eventosFiltro: row.eventos_filtro,
      segredoAtual: decryptWebhookSecret(row.segredo_atual_cifrado),
      ativo: row.ativo,
      criadoEm: row.criado_em,
    };
  }

  // RLS (tenant_isolation, FORCE ROW LEVEL SECURITY) filtra id inexistente
  // ou de outro tenant para 0 linhas de forma silenciosa -- UPDATE nunca
  // lança erro por isso. CerbosGuard não é uma segunda barreira real aqui
  // (monta resource.attr.tenant_id a partir do tenant do REQUISITANTE, nunca
  // busca o recurso pra confirmar posse -- ver achado da revisão de
  // código), então sem este rowCount === 0 o controller devolveria 200
  // implicando sucesso quando nada mudou.
  async update(client: PoolClient, id: string, input: { url?: string; eventosFiltro?: string[] }): Promise<void> {
    const result = await client.query(
      `UPDATE webhook_endpoint SET url = COALESCE($2, url), eventos_filtro = COALESCE($3, eventos_filtro) WHERE id = $1`,
      [id, input.url ?? null, input.eventosFiltro ?? null],
    );
    if (result.rowCount === 0) {
      throw new NotFoundException('Endpoint de webhook não encontrado');
    }
  }

  // Mesmo raciocínio de update() acima -- RLS filtra silenciosamente, então
  // o rowCount === 0 é a única barreira real contra um 200 falso-positivo.
  async deactivate(client: PoolClient, id: string): Promise<void> {
    const result = await client.query(`UPDATE webhook_endpoint SET ativo = false WHERE id = $1`, [id]);
    if (result.rowCount === 0) {
      throw new NotFoundException('Endpoint de webhook não encontrado');
    }
  }

  // Move o segredo atual para o histórico (cap MAX_HISTORICO -- descarta o
  // mais antigo além do limite, ver design spec decisão 17), gera um novo.
  async rotateSecret(client: PoolClient, id: string): Promise<{ segredoAtual: string }> {
    const atual = await client.query<{ segredo_atual_cifrado: EncryptedSecret; segredos_historico_cifrados: EncryptedSecret[] }>(
      `SELECT segredo_atual_cifrado, segredos_historico_cifrados FROM webhook_endpoint WHERE id = $1`,
      [id],
    );
    // RLS filtra id inexistente/de outro tenant para 0 linhas silenciosamente
    // (CerbosGuard não confirma posse real -- ver achado da revisão de
    // código); sem este check, atual.rows[0] é undefined e a linha seguinte
    // lança TypeError não tratado (vira 500 genérico em vez de 404). Mesmo
    // padrão de ApiKeyService.rotate/revoke.
    if (atual.rows.length === 0) {
      throw new NotFoundException('Endpoint de webhook não encontrado');
    }
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
