// Shared helpers for the tracker's Blob-backed state. Files starting with "_" are not routes.
//
// Why every save is a NEW blob: Vercel's CDN can keep serving an older copy of an overwritten blob URL,
// so read-after-write through a fixed URL is not reliable. Instead each save creates a fresh, uniquely
// named blob (a URL nobody has cached), and readers pick the newest one from list(), which is consistent.
import { put, list, del } from '@vercel/blob';
import { timingSafeEqual, randomBytes } from 'node:crypto';

const PREFIX = 'geo-tracker/state-';
const KEEP = 5; // newest versions kept as a rolling backup

export function sameKey(given, want) {
  if (!given || !want) return false;
  const a = Buffer.from(String(given));
  const b = Buffer.from(String(want));
  return a.length === b.length && timingSafeEqual(a, b);
}

async function versions() {
  const { blobs } = await list({ prefix: PREFIX, limit: 200 });
  return blobs.sort((a, b) => new Date(b.uploadedAt) - new Date(a.uploadedAt) || (a.pathname < b.pathname ? 1 : -1));
}

export async function readState() {
  const [latest] = await versions();
  if (!latest) return null;
  const r = await fetch(latest.url, { cache: 'no-store' });
  return r.ok ? r.json() : null;
}

export async function writeState(state) {
  const json = JSON.stringify(state);
  if (json.length > 250000) throw Object.assign(new Error('State too large'), { status: 413 });
  const path = `${PREFIX}${String(Date.now()).padStart(14, '0')}-${randomBytes(3).toString('hex')}.json`;
  await put(path, json, { access: 'public', addRandomSuffix: false, contentType: 'application/json', cacheControlMaxAge: 60 });
  try {
    const old = (await versions()).slice(KEEP);
    if (old.length) await del(old.map((b) => b.url));
  } catch { /* pruning is best effort */ }
}
