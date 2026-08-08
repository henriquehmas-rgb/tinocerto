'use client';

const ACCESS_TOKEN_KEY = 'tinocerto_staff_access_token';
const REFRESH_TOKEN_KEY = 'tinocerto_staff_refresh_token';

function apiUrl(path: string): string {
  return `${process.env.NEXT_PUBLIC_API_URL}${path}`;
}

export interface StaffTokens {
  accessToken: string;
  refreshToken: string;
}

export interface StaffMfaChallenge {
  mfaChallengeToken: string;
}

export type StaffLoginResult = StaffTokens | StaffMfaChallenge;

function isMfaChallenge(result: StaffLoginResult): result is StaffMfaChallenge {
  return 'mfaChallengeToken' in result;
}

export const staffAuthClient = {
  isMfaChallenge,

  async onboard(input: { nomeEmpresa: string; cnpj: string; emailAdmin: string; senhaAdmin: string }): Promise<StaffTokens> {
    const response = await fetch(apiUrl('/v1/staff/auth/onboarding'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    });
    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      throw new Error(body.message ?? 'Não foi possível criar a conta da empresa');
    }
    const tokens: StaffTokens = await response.json();
    localStorage.setItem(ACCESS_TOKEN_KEY, tokens.accessToken);
    localStorage.setItem(REFRESH_TOKEN_KEY, tokens.refreshToken);
    return tokens;
  },

  async login(input: { email: string; senha: string }): Promise<StaffLoginResult> {
    const response = await fetch(apiUrl('/v1/staff/auth/login'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    });
    if (!response.ok) {
      throw new Error('E-mail ou senha inválidos');
    }
    const result: StaffLoginResult = await response.json();
    if (!isMfaChallenge(result)) {
      localStorage.setItem(ACCESS_TOKEN_KEY, result.accessToken);
      localStorage.setItem(REFRESH_TOKEN_KEY, result.refreshToken);
    }
    return result;
  },

  async loginMfa(input: { mfaChallengeToken: string; codigoTotp: string }): Promise<StaffTokens> {
    const response = await fetch(apiUrl('/v1/staff/auth/login/mfa'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    });
    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      throw new Error(body.message ?? 'Código TOTP inválido');
    }
    const tokens: StaffTokens = await response.json();
    localStorage.setItem(ACCESS_TOKEN_KEY, tokens.accessToken);
    localStorage.setItem(REFRESH_TOKEN_KEY, tokens.refreshToken);
    return tokens;
  },

  async mfaSetup(): Promise<{ qrCodeDataUri: string }> {
    const response = await this.authenticatedFetch('/v1/staff/auth/mfa/setup', { method: 'POST' });
    if (!response.ok) {
      throw new Error('Não foi possível iniciar a configuração de MFA');
    }
    return response.json();
  },

  async mfaVerify(input: { codigoTotp: string }): Promise<{ backupCodes: string[] }> {
    const response = await this.authenticatedFetch('/v1/staff/auth/mfa/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    });
    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      throw new Error(body.message ?? 'Código TOTP inválido');
    }
    return response.json();
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
    const response = await fetch(apiUrl('/v1/staff/auth/refresh'), {
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

    if (!accessToken) throw new Error('Usuário não autenticado');

    let response = await doFetch(accessToken);
    if (response.status === 401) {
      const renewed = await this.refreshAccessToken();
      if (!renewed) throw new Error('Sessão expirada, faça login novamente');
      response = await doFetch(renewed);
    }
    return response;
  },
};
