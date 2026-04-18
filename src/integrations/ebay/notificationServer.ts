import { createHash, createPublicKey, createVerify } from 'node:crypto';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import axios from 'axios';
import { env } from '../../config/env.js';
import { logger } from '../../utils/logger.js';
import { getEbayAccessToken } from './oauth.js';

const MAX_BODY_BYTES = 128 * 1024;
const PUBLIC_KEY_TTL_MS = 60 * 60 * 1000;

interface EbayNotificationMetadata {
  topic?: string;
  schemaVersion?: string;
  deprecated?: boolean;
}

interface EbayDeletionNotificationData {
  username?: string;
  userId?: string;
  eiasToken?: string;
}

interface EbayDeletionNotification {
  notificationId?: string;
  eventDate?: string;
  publishDate?: string;
  publishAttemptCount?: number;
  data?: EbayDeletionNotificationData;
}

interface EbayDeletionNotificationPayload {
  metadata?: EbayNotificationMetadata;
  notification?: EbayDeletionNotification;
}

interface DecodedSignatureHeader {
  alg: string;
  digest: string;
  kid: string;
  signature: string;
}

type SignatureVerificationResult = 'verified' | 'invalid' | 'skipped';

const publicKeyCache = new Map<string, { key: string; expiresAt: number }>();

function isNotificationServerEnabled(): boolean {
  return Boolean(env.EBAY_NOTIFICATION_PUBLIC_URL && env.EBAY_NOTIFICATION_VERIFICATION_TOKEN);
}

function sendJson(response: ServerResponse, statusCode: number, payload: Record<string, unknown>): void {
  response.statusCode = statusCode;
  response.setHeader('content-type', 'application/json');
  response.end(JSON.stringify(payload));
}

function computeChallengeResponse(challengeCode: string): string {
  const hash = createHash('sha256');
  hash.update(challengeCode);
  hash.update(env.EBAY_NOTIFICATION_VERIFICATION_TOKEN);
  hash.update(env.EBAY_NOTIFICATION_PUBLIC_URL);
  return hash.digest('hex');
}

function normalizePublicKey(publicKey: string): string {
  const trimmed = publicKey.trim();
  if (trimmed.includes('\n')) return trimmed;
  if (!trimmed.startsWith('-----BEGIN PUBLIC KEY-----')) return trimmed;

  const body = trimmed
    .replace('-----BEGIN PUBLIC KEY-----', '')
    .replace('-----END PUBLIC KEY-----', '')
    .trim();

  return `-----BEGIN PUBLIC KEY-----\n${body}\n-----END PUBLIC KEY-----`;
}

function decodeSignatureHeader(signatureHeader: string): DecodedSignatureHeader | null {
  try {
    const decoded = Buffer.from(signatureHeader, 'base64').toString('utf8');
    const parsed = JSON.parse(decoded) as Partial<DecodedSignatureHeader>;
    if (!parsed.alg || !parsed.digest || !parsed.kid || !parsed.signature) {
      return null;
    }

    return {
      alg: parsed.alg,
      digest: parsed.digest,
      kid: parsed.kid,
      signature: parsed.signature,
    };
  } catch {
    return null;
  }
}

async function getNotificationPublicKey(keyId: string): Promise<string> {
  const cached = publicKeyCache.get(keyId);
  if (cached && Date.now() < cached.expiresAt) {
    return cached.key;
  }

  const token = await getEbayAccessToken();
  const response = await axios.get<{ key: string }>(
    `https://api.ebay.com/commerce/notification/v1/public_key/${encodeURIComponent(keyId)}`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    },
  );

  const normalizedKey = normalizePublicKey(response.data.key);
  publicKeyCache.set(keyId, {
    key: normalizedKey,
    expiresAt: Date.now() + PUBLIC_KEY_TTL_MS,
  });

  return normalizedKey;
}

async function verifyNotificationSignature(
  rawBody: string,
  signatureHeader: string | string[] | undefined,
): Promise<SignatureVerificationResult> {
  if (!signatureHeader || env.EBAY_PROVIDER !== 'live') {
    return 'skipped';
  }

  const headerValue = Array.isArray(signatureHeader) ? signatureHeader[0] : signatureHeader;
  const decodedHeader = decodeSignatureHeader(headerValue);
  if (!decodedHeader) {
    return 'invalid';
  }

  if (decodedHeader.alg !== 'ECDSA' || decodedHeader.digest.toUpperCase() !== 'SHA1') {
    logger.warn({
      algorithm: decodedHeader.alg,
      digest: decodedHeader.digest,
    }, 'Unsupported eBay notification signature parameters');
    return 'invalid';
  }

  try {
    const publicKey = await getNotificationPublicKey(decodedHeader.kid);
    const verifier = createVerify('sha1');
    verifier.update(rawBody);
    verifier.end();

    const verified = verifier.verify(
      createPublicKey(publicKey),
      Buffer.from(decodedHeader.signature, 'base64'),
    );

    return verified ? 'verified' : 'invalid';
  } catch (error) {
    logger.warn({ error }, 'Unable to verify eBay notification signature');
    return 'skipped';
  }
}

function parsePayload(rawBody: string): EbayDeletionNotificationPayload | null {
  try {
    return JSON.parse(rawBody) as EbayDeletionNotificationPayload;
  } catch {
    return null;
  }
}

async function readRequestBody(request: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  let totalBytes = 0;

  for await (const chunk of request) {
    const buffer = typeof chunk === 'string' ? Buffer.from(chunk) : chunk;
    totalBytes += buffer.length;

    if (totalBytes > MAX_BODY_BYTES) {
      throw new Error('Request body too large');
    }

    chunks.push(buffer);
  }

  return Buffer.concat(chunks).toString('utf8');
}

async function processDeletionNotification(
  rawBody: string,
  signatureHeader: string | string[] | undefined,
): Promise<void> {
  const payload = parsePayload(rawBody);
  if (!payload) {
    logger.warn('Received malformed eBay notification payload');
    return;
  }

  const signatureVerification = await verifyNotificationSignature(rawBody, signatureHeader);
  logger.info({
    topic: payload.metadata?.topic,
    notificationId: payload.notification?.notificationId,
    publishDate: payload.notification?.publishDate,
    signatureVerification,
  }, 'Processed eBay marketplace account deletion notification');

  if (signatureVerification === 'invalid') {
    logger.warn('eBay notification signature could not be validated');
  }
}

async function handleRequest(request: IncomingMessage, response: ServerResponse): Promise<void> {
  const requestUrl = new URL(request.url ?? '/', `http://${request.headers.host ?? 'localhost'}`);
  if (requestUrl.pathname !== env.EBAY_NOTIFICATION_PATH) {
    response.statusCode = 404;
    response.end('Not Found');
    return;
  }

  if (request.method === 'GET') {
    const challengeCode = requestUrl.searchParams.get('challenge_code');
    if (!challengeCode) {
      sendJson(response, 400, { error: 'Missing challenge_code' });
      return;
    }

    sendJson(response, 200, {
      challengeResponse: computeChallengeResponse(challengeCode),
    });

    logger.info({
      path: env.EBAY_NOTIFICATION_PATH,
      challengeCodeLength: challengeCode.length,
    }, 'Responded to eBay notification challenge');
    return;
  }

  if (request.method === 'POST') {
    try {
      const rawBody = await readRequestBody(request);
      response.statusCode = 204;
      response.end();
      void processDeletionNotification(rawBody, request.headers['x-ebay-signature']);
    } catch (error) {
      logger.warn({ error }, 'Failed to read eBay notification payload');
      sendJson(response, 400, { error: 'Invalid request body' });
    }
    return;
  }

  response.statusCode = 405;
  response.setHeader('allow', 'GET, POST');
  response.end('Method Not Allowed');
}

export async function startEbayNotificationServer(): Promise<Server | null> {
  if (!isNotificationServerEnabled()) {
    return null;
  }

  const publicUrl = new URL(env.EBAY_NOTIFICATION_PUBLIC_URL);
  if (publicUrl.pathname !== env.EBAY_NOTIFICATION_PATH) {
    logger.warn({
      publicPath: publicUrl.pathname,
      localPath: env.EBAY_NOTIFICATION_PATH,
    }, 'Public eBay notification URL path differs from local listener path');
  }

  const server = createServer((request, response) => {
    void handleRequest(request, response).catch(error => {
      logger.error({ error }, 'Unexpected error in eBay notification server');
      if (!response.headersSent) {
        sendJson(response, 500, { error: 'Internal Server Error' });
        return;
      }

      response.destroy();
    });
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(env.EBAY_NOTIFICATION_PORT, env.EBAY_NOTIFICATION_BIND_HOST, () => {
      server.off('error', reject);
      resolve();
    });
  });

  logger.info({
    host: env.EBAY_NOTIFICATION_BIND_HOST,
    port: env.EBAY_NOTIFICATION_PORT,
    path: env.EBAY_NOTIFICATION_PATH,
    publicUrl: env.EBAY_NOTIFICATION_PUBLIC_URL,
  }, 'eBay notification webhook listening');

  return server;
}
