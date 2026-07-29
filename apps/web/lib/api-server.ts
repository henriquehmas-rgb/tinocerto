export async function apiServerFetch<T>(path: string): Promise<T | null> {
  const baseUrl = process.env.API_URL ?? 'http://localhost:3000';
  const response = await fetch(`${baseUrl}${path}`, { cache: 'no-store' });
  if (response.status === 404) return null;
  if (!response.ok) {
    throw new Error(`Falha ao buscar ${path}: ${response.status}`);
  }
  return response.json() as Promise<T>;
}
