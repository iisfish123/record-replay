import { join } from 'node:path';

export const STORAGE_ROOT = join(process.cwd(), 'storage');
export const PUBLIC_URL_PREFIX = '/static';

export function toPublicUrl(publicBaseUrl: string, relativePath: string): string {
  const base = publicBaseUrl.replace(/\/+$/, '');
  const rel = relativePath.replace(/^\/+/, '');
  return `${base}${PUBLIC_URL_PREFIX}/${rel}`;
}
