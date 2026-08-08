import { createHash, createHmac } from 'node:crypto';

/**
 * AWS Signature Version 4 for Product Advertising API 5.0.
 *
 * PA-API is not a normal REST API: it is an AWS service, so every request must
 * carry a SigV4 signature derived from the secret key. There is no bearer
 * token and no SDK dependency worth adding for one operation.
 *
 * SigV4 is unforgiving — a single wrong byte in the canonical request produces
 * an opaque "signature does not match" with no indication of which step was
 * wrong. Each step is therefore a separate exported function so it can be
 * inspected and asserted independently.
 */

export interface SignatureInput {
  method: 'POST';
  host: string;
  path: string;
  region: string;
  service: string;
  target: string;
  payload: string;
  accessKey: string;
  secretKey: string;
  /** Defaults to now. Injectable so signatures are reproducible in tests. */
  now?: Date;
}

export interface SignedRequest {
  headers: Record<string, string>;
  amzDate: string;
  dateStamp: string;
  canonicalRequest: string;
  stringToSign: string;
  signature: string;
}

const sha256Hex = (value: string): string =>
  createHash('sha256').update(value, 'utf8').digest('hex');

const hmac = (key: Buffer | string, value: string): Buffer =>
  createHmac('sha256', key).update(value, 'utf8').digest();

/** ISO8601 basic format: 20260806T123456Z */
export function toAmzDate(date: Date): string {
  return date.toISOString().replace(/[:-]|\.\d{3}/g, '');
}

/** YYYYMMDD */
export function toDateStamp(date: Date): string {
  return toAmzDate(date).slice(0, 8);
}

/**
 * Canonical request.
 *
 * Header names must be lowercase, sorted, and each value trimmed; the signed
 * header list must match exactly what is sent. The two trailing newlines
 * before the payload hash are required by the spec and are the single most
 * common source of silent mismatches.
 */
export function buildCanonicalRequest(input: {
  method: string;
  path: string;
  headers: Record<string, string>;
  payload: string;
}): { canonicalRequest: string; signedHeaders: string } {
  const entries = Object.entries(input.headers)
    .map(([name, value]) => [name.toLowerCase(), value.trim().replace(/\s+/g, ' ')] as const)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));

  const canonicalHeaders = entries.map(([n, v]) => `${n}:${v}\n`).join('');
  const signedHeaders = entries.map(([n]) => n).join(';');

  const canonicalRequest = [
    input.method,
    input.path,
    '', // canonical query string — PA-API puts everything in the body
    canonicalHeaders,
    signedHeaders,
    sha256Hex(input.payload),
  ].join('\n');

  return { canonicalRequest, signedHeaders };
}

export function buildStringToSign(input: {
  amzDate: string;
  dateStamp: string;
  region: string;
  service: string;
  canonicalRequest: string;
}): string {
  const scope = `${input.dateStamp}/${input.region}/${input.service}/aws4_request`;
  return [
    'AWS4-HMAC-SHA256',
    input.amzDate,
    scope,
    sha256Hex(input.canonicalRequest),
  ].join('\n');
}

/** Four chained HMACs, each keyed by the previous result. */
export function deriveSigningKey(input: {
  secretKey: string;
  dateStamp: string;
  region: string;
  service: string;
}): Buffer {
  const kDate = hmac(`AWS4${input.secretKey}`, input.dateStamp);
  const kRegion = hmac(kDate, input.region);
  const kService = hmac(kRegion, input.service);
  return hmac(kService, 'aws4_request');
}

export function signRequest(input: SignatureInput): SignedRequest {
  const now = input.now ?? new Date();
  const amzDate = toAmzDate(now);
  const dateStamp = toDateStamp(now);

  const headers: Record<string, string> = {
    'content-encoding': 'amz-1.0',
    'content-type': 'application/json; charset=utf-8',
    host: input.host,
    'x-amz-date': amzDate,
    'x-amz-target': input.target,
  };

  const { canonicalRequest, signedHeaders } = buildCanonicalRequest({
    method: input.method,
    path: input.path,
    headers,
    payload: input.payload,
  });

  const stringToSign = buildStringToSign({
    amzDate,
    dateStamp,
    region: input.region,
    service: input.service,
    canonicalRequest,
  });

  const signingKey = deriveSigningKey({
    secretKey: input.secretKey,
    dateStamp,
    region: input.region,
    service: input.service,
  });

  const signature = createHmac('sha256', signingKey)
    .update(stringToSign, 'utf8')
    .digest('hex');

  const scope = `${dateStamp}/${input.region}/${input.service}/aws4_request`;

  return {
    headers: {
      ...headers,
      Authorization:
        `AWS4-HMAC-SHA256 Credential=${input.accessKey}/${scope}, ` +
        `SignedHeaders=${signedHeaders}, Signature=${signature}`,
    },
    amzDate,
    dateStamp,
    canonicalRequest,
    stringToSign,
    signature,
  };
}
