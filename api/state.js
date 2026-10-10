// Stores the tracker's editable state (card status, evidence, survey rows, ...) in a Vercel Blob.
// GET  /api/state  -> public, returns the saved state plus { canEdit } for the supplied key
// PUT  /api/state  -> requires header x-edit-key matching EDIT_KEY. Replaces the editable fields only;
//                     formResponses (written by /api/survey from the Google Form) are always kept.
import { readState, writeState, sameKey } from './_store.js';

const ALLOWED = ['plan', 'gates', 'deliverables', 'observation', 'verdict', 'survey', 'interviews', 'audits'];

const keyOk = (req) => sameKey(req.headers['x-edit-key'], process.env.EDIT_KEY);

// Keep only plain JSON, cap sizes, drop prototype-pollution keys.
function clean(v, depth = 0) {
  if (depth > 6) return null;
  if (typeof v === 'string') return v.slice(0, 4000);
  if (typeof v === 'number' || typeof v === 'boolean' || v === null) return v;
  if (Array.isArray(v)) return v.slice(0, 300).map((x) => clean(x, depth + 1));
  if (typeof v === 'object') {
    const out = {};
    for (const k of Object.keys(v).slice(0, 120)) {
      if (k === '__proto__' || k === 'constructor' || k === 'prototype' || k.length > 80) continue;
      out[k] = clean(v[k], depth + 1);
    }
    return out;
  }
  return null;
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  try {
    if (req.method === 'GET') {
      const saved = (await readState()) || {};
      return res.status(200).json({ ...saved, canEdit: keyOk(req) });
    }
    if (req.method === 'PUT') {
      if (!keyOk(req)) return res.status(401).json({ error: 'Edit key rejected' });
      const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
      if (!body || typeof body !== 'object' || Array.isArray(body)) return res.status(400).json({ error: 'Body must be an object' });
      const prev = (await readState()) || {};
      const next = { updatedAt: new Date().toISOString() };
      for (const k of ALLOWED) if (body[k] !== undefined) next[k] = clean(body[k]);
      if (prev.formResponses) next.formResponses = prev.formResponses; // owned by the Google Form feed
      await writeState(next);
      return res.status(200).json({ ok: true, updatedAt: next.updatedAt });
    }
    res.setHeader('Allow', 'GET, PUT');
    return res.status(405).json({ error: 'Method not allowed' });
  } catch (e) {
    return res.status(e.status || 500).json({ error: e.status ? e.message : 'Server error', detail: String(e.message || e).slice(0, 200) });
  }
}
