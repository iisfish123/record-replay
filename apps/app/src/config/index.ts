const RAW_BASE = (import.meta.env?.VITE_API_BASE_URL as string | undefined) ?? 'http://localhost:3000';

export const API_BASE_URL = RAW_BASE.replace(/\/+$/, '');

export function absoluteUrl(pathOrUrl: string): string {
  if (!pathOrUrl) return '';
  if (/^https?:\/\//i.test(pathOrUrl)) return pathOrUrl;
  return `${API_BASE_URL}${pathOrUrl.startsWith('/') ? '' : '/'}${pathOrUrl}`;
}
