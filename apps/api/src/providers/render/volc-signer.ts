import { createHash, createHmac } from 'node:crypto';

const SERVICE = 'cv';
const REGION = 'cn-north-1';
const HOST = 'visual.volcengineapi.com';

function sha256Hex(data: Buffer | string): string {
  return createHash('sha256').update(data).digest('hex');
}

function hmac(key: Buffer | string, data: string): Buffer {
  return createHmac('sha256', key).update(data).digest();
}

export interface SignedRequest {
  url: string;
  headers: Record<string, string>;
  body: string;
}

/**
 * 火山引擎 v4 签名（AK/SK）。
 * 固定签名域：Service=cv，Region=cn-north-1；签名头 content-type;host;x-content-sha256;x-date。
 */
export function signVolcRequest(
  params: { accessKeyId: string; accessKeySecret: string; query: Record<string, string> },
  bodyObj: Record<string, unknown>,
): SignedRequest {
  const body = JSON.stringify(bodyObj);
  const now = new Date();
  const xDate = now.toISOString().replace(/[:-]|\.\d{3}/g, '');
  const shortDate = xDate.slice(0, 8);
  const payloadHash = sha256Hex(body);

  const signedHeaders = 'content-type;host;x-content-sha256;x-date';
  const canonicalHeaders =
    `content-type:application/json\n` +
    `host:${HOST}\n` +
    `x-content-sha256:${payloadHash}\n` +
    `x-date:${xDate}\n`;

  const canonicalQuery = Object.keys(params.query)
    .sort()
    .map((k) => `${encodeURIComponent(k)}=${encodeURIComponent(params.query[k])}`)
    .join('&');

  const canonicalRequest = [
    'POST',
    '/',
    canonicalQuery,
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join('\n');

  const credentialScope = `${shortDate}/${REGION}/${SERVICE}/request`;
  const stringToSign = [
    'HMAC-SHA256',
    xDate,
    credentialScope,
    sha256Hex(canonicalRequest),
  ].join('\n');

  const kDate = hmac(params.accessKeySecret, shortDate);
  const kRegion = hmac(kDate, REGION);
  const kService = hmac(kRegion, SERVICE);
  const kSigning = hmac(kService, 'request');
  const signature = createHmac('sha256', kSigning).update(stringToSign).digest('hex');

  const authorization =
    `HMAC-SHA256 Credential=${params.accessKeyId}/${credentialScope}, ` +
    `SignedHeaders=${signedHeaders}, Signature=${signature}`;

  return {
    url: `https://${HOST}/?${canonicalQuery}`,
    headers: {
      'Content-Type': 'application/json',
      'X-Date': xDate,
      'X-Content-Sha256': payloadHash,
      Authorization: authorization,
    },
    body,
  };
}
