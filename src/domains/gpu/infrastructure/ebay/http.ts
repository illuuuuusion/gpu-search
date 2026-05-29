import axios from 'axios';
import { env, getEbayApiBaseUrl } from '../../../../app/env/index.js';

export const ebayHttpClient = axios.create({
  baseURL: getEbayApiBaseUrl(),
  timeout: env.EBAY_HTTP_TIMEOUT_MS,
});

const RETRYABLE_CODES = new Set(['ECONNRESET', 'ETIMEDOUT', 'ECONNABORTED', 'EAI_AGAIN']);

function isRetryable(error: unknown): boolean {
  if (!axios.isAxiosError(error)) return false;
  const status = error.response?.status;
  if (status !== undefined) return status === 429 || status >= 500;
  return RETRYABLE_CODES.has(error.code ?? '');
}

function getRetryDelayMs(error: unknown, attempt: number): number {
  if (axios.isAxiosError(error) && error.response?.status === 429) {
    const seconds = Number(error.response.headers['retry-after']);
    if (Number.isFinite(seconds) && seconds > 0) return seconds * 1000;
  }
  return env.EBAY_HTTP_RETRY_DELAY_MS * 2 ** attempt;
}

export async function withRetry<T>(fn: () => Promise<T>): Promise<T> {
  let attempt = 0;
  for (;;) {
    try {
      return await fn();
    } catch (error) {
      if (!isRetryable(error) || attempt >= env.EBAY_HTTP_MAX_RETRIES) throw error;
      await new Promise(resolve => setTimeout(resolve, getRetryDelayMs(error, attempt)));
      attempt += 1;
    }
  }
}
