import { PlatformApiProblem } from './platform-api-problem';

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
