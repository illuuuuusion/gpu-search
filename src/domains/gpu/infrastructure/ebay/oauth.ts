import { env } from '../../../../app/env/index.js';
import { ebayHttpClient, withRetry } from './http.js';

let cachedToken: { accessToken: string; expiresAt: number } | null = null;
let pendingTokenRequest: Promise<string> | null = null;

async function fetchNewToken(): Promise<string> {
  const credentials = Buffer.from(`${env.EBAY_APP_ID}:${env.EBAY_CLIENT_SECRET}`).toString('base64');
  const body = new URLSearchParams({
    grant_type: 'client_credentials',
    scope: 'https://api.ebay.com/oauth/api_scope',
  });

  const response = await withRetry(() =>
    ebayHttpClient.post('/identity/v1/oauth2/token', body.toString(), {
      headers: {
        Authorization: `Basic ${credentials}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
    }),
  );

  const { access_token, expires_in } = response.data as Record<string, unknown>;
  if (typeof access_token !== 'string' || !access_token) {
    throw new Error('eBay OAuth: missing access_token in response');
  }
  if (typeof expires_in !== 'number' || !Number.isFinite(expires_in)) {
    throw new Error('eBay OAuth: missing or invalid expires_in in response');
  }

  cachedToken = {
    accessToken: access_token,
    expiresAt: Date.now() + (expires_in - 60) * 1000,
  };

  return cachedToken.accessToken;
}

export async function getEbayAccessToken(): Promise<string> {
  if (cachedToken && Date.now() < cachedToken.expiresAt) return cachedToken.accessToken;

  if (pendingTokenRequest) return pendingTokenRequest;

  pendingTokenRequest = fetchNewToken().finally(() => {
    pendingTokenRequest = null;
  });

  return pendingTokenRequest;
}
