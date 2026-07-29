'use client';

const ACCESS_TOKEN_KEY = 'tinocerto_candidate_access_token';
const REFRESH_TOKEN_KEY = 'tinocerto_candidate_refresh_token';

function apiUrl(path: string): string {
  return `${process.env.NEXT_PUBLIC_API_URL}${path}`;
}

export const candidateAuthClient = {
  async register(input: { email: string; senha: string; nome: string; cpf: string }): Promise<void> {
    const response = await fetch(apiUrl('/v1/candidate/auth/register'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    });
    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      throw new Error(body.message ?? 'Não foi possível criar a conta');
    }
    const { accessToken, refreshToken } = await response.json();
    localStorage.setItem(ACCESS_TOKEN_KEY, accessToken);
    localStorage.setItem(REFRESH_TOKEN_KEY, refreshToken);
  },

  async login(input: { email: string; senha: string }): Promise<void> {
    const response = await fetch(apiUrl('/v1/candidate/auth/login'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    });
    if (!response.ok) {
      throw new Error('E-mail ou senha inválidos');
    }
    const { accessToken, refreshToken } = await response.json();
    localStorage.setItem(ACCESS_TOKEN_KEY, accessToken);
    localStorage.setItem(REFRESH_TOKEN_KEY, refreshToken);
  },

  logout(): void {
    localStorage.removeItem(ACCESS_TOKEN_KEY);
    localStorage.removeItem(REFRESH_TOKEN_KEY);
  },

  isLoggedIn(): boolean {
    return Boolean(localStorage.getItem(ACCESS_TOKEN_KEY));
  },

  /**
   * Retorna um access token válido, renovando via refresh token se
   * necessário. Detecta expiração pela resposta 401 de uma chamada real,
   * não decodificando o JWT no cliente (mais simples, e o servidor é
   * quem decide o que é válido de qualquer forma).
   */
  async getValidAccessToken(): Promise<string | null> {
    const accessToken = localStorage.getItem(ACCESS_TOKEN_KEY);
    if (!accessToken) return null;
    return accessToken;
  },

  async refreshAccessToken(): Promise<string | null> {
    const refreshToken = localStorage.getItem(REFRESH_TOKEN_KEY);
    if (!refreshToken) return null;
    const response = await fetch(apiUrl('/v1/candidate/auth/refresh'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken }),
    });
    if (!response.ok) {
      this.logout();
      return null;
    }
    const { accessToken, refreshToken: newRefreshToken } = await response.json();
    localStorage.setItem(ACCESS_TOKEN_KEY, accessToken);
    localStorage.setItem(REFRESH_TOKEN_KEY, newRefreshToken);
    return accessToken;
  },

  /**
   * fetch autenticado com retry automático de uma vez via refresh token
   * se a primeira tentativa voltar 401 (access token expirado).
   */
  async authenticatedFetch(path: string, init: RequestInit = {}): Promise<Response> {
    const accessToken = await this.getValidAccessToken();
    const doFetch = (token: string) =>
      fetch(apiUrl(path), { ...init, headers: { ...init.headers, Authorization: `Bearer ${token}` } });

    if (!accessToken) throw new Error('Candidato não autenticado');

    let response = await doFetch(accessToken);
    if (response.status === 401) {
      const renewed = await this.refreshAccessToken();
      if (!renewed) throw new Error('Sessão expirada, faça login novamente');
      response = await doFetch(renewed);
    }
    return response;
  },
};
