import { PlatformApiProblem } from './platform-api-problem';

// Achado Minor da revisao consolidada pos-Fase 4: este cursor e opaco
// no sentido de CONTRATO DE API (o cliente nunca deve depender do seu
// formato interno), nao no sentido de CONFIDENCIALIDADE -- e so
// base64url, decodificavel por qualquer um sem chave nenhuma.
// Inofensivo hoje: {sortValue, id} expoe created_at/enviado_em e um UUID
// v4 (nao sequencial, nao enumeravel), e a resposta paginada ja inclui
// os dois em texto claro em cada item. MAS este helper e generico e
// reutilizavel -- se um endpoint futuro paginar por um campo de
// ordenacao sensivel (valor monetario, score, etc.), decodificar o
// cursor passaria a vazar esse dado de verdade. Se isso acontecer,
// cifrar o cursor (ex.: AES-256-GCM com uma chave do servidor) antes
// de reusar este mesmo helper.
export interface Cursor {
  sortValue: string;
  id: string;
}

export function encodeCursor(cursor: Cursor): string {
  return Buffer.from(JSON.stringify(cursor)).toString('base64url');
}

export function decodeCursor(raw: string): Cursor {
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(raw, 'base64url').toString('utf-8'));
  } catch {
    throw new PlatformApiProblem(422, 'cursor-invalido', 'Cursor inválido', 'O parâmetro cursor não pôde ser decodificado.');
  }
  if (
    typeof parsed !== 'object' ||
    parsed === null ||
    typeof (parsed as Record<string, unknown>).sortValue !== 'string' ||
    typeof (parsed as Record<string, unknown>).id !== 'string'
  ) {
    throw new PlatformApiProblem(422, 'cursor-invalido', 'Cursor inválido', 'O cursor decodificado não tem a forma esperada {sortValue, id}.');
  }
  return parsed as Cursor;
}
