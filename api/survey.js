// Receives Google Form responses and appends them to the tracker's state.
// POST   /api/survey   header x-ingest-key (INGEST_KEY). Body: { formResponseId, submittedAt, answers: { q1..q10: "A".."F" } }
//                      Idempotent on formResponseId: re-sending never adds a second row, and fills in any blank answers.
// DELETE /api/survey?formResponseId=...   header x-edit-key (EDIT_KEY). Removes one response.
// The ingest key can only add survey responses; it cannot change the board.
import { readState, writeState, sameKey } from './_store.js';

const MAX_RESPONSES = 500;
const QS = Array.from({ length: 10 }, (_, i) => 'q' + (i + 1));

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  try {
    if (req.method === 'POST') {
      if (!sameKey(req.headers['x-ingest-key'], process.env.INGEST_KEY)) return res.status(401).json({ error: 'Ingest key rejected' });
      const b = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
      const fid = b && typeof b.formResponseId === 'string' ? b.formResponseId.slice(0, 120) : '';
      if (!fid || !b.answers || typeof b.answers !== 'object') return res.status(400).json({ error: 'formResponseId and answers are required' });
      const row = { formResponseId: fid, submittedAt: String(b.submittedAt || new Date().toISOString()).slice(0, 40), source: 'form' };
      for (const q of QS) {
        const a = String(b.answers[q] || '').toUpperCase();
        if (a && !/^[A-F]$/.test(a)) return res.status(400).json({ error: `Answer for ${q} must be a single letter A to F` });
        row[q] = a;
      }
      const raw = {};
      if (b.raw && typeof b.raw === 'object') for (const q of QS) if (typeof b.raw[q] === 'string') raw[q] = b.raw[q].slice(0, 200);
      const state = (await readState()) || {};
      const list = Array.isArray(state.formResponses) ? state.formResponses : [];
      const at = list.findIndex((r) => r.formResponseId === fid);
      if (at >= 0) {
        // Already stored: fill in answers that were blank or have changed, keep everything else.
        let changed = false;
        const merged = { ...list[at] };
        for (const q of QS) if (row[q] && row[q] !== merged[q]) { merged[q] = row[q]; changed = true; }
        if (Object.keys(raw).length && JSON.stringify(raw) !== JSON.stringify(merged.raw || {})) { merged.raw = { ...(merged.raw || {}), ...raw }; changed = true; }
        if (changed) {
          state.formResponses = list.map((r, i) => (i === at ? merged : r));
          state.updatedAt = new Date().toISOString();
          await writeState(state);
        }
        return res.status(200).json({ ok: true, duplicate: true, updated: changed, count: list.length });
      }
      if (list.length >= MAX_RESPONSES) return res.status(413).json({ error: 'Response limit reached' });
      if (Object.keys(raw).length) row.raw = raw;
      row.id = 'F' + (list.length + 1);
      state.formResponses = [...list, row];
      state.updatedAt = new Date().toISOString();
      await writeState(state);
      return res.status(200).json({ ok: true, duplicate: false, count: state.formResponses.length });
    }
    if (req.method === 'DELETE') {
      if (!sameKey(req.headers['x-edit-key'], process.env.EDIT_KEY)) return res.status(401).json({ error: 'Edit key rejected' });
      const fid = String((req.query && req.query.formResponseId) || '');
      const state = (await readState()) || {};
      const list = Array.isArray(state.formResponses) ? state.formResponses : [];
      const kept = list.filter((r) => r.formResponseId !== fid);
      if (kept.length === list.length) return res.status(404).json({ error: 'No response with that formResponseId' });
      state.formResponses = kept.map((r, i) => ({ ...r, id: 'F' + (i + 1) }));
      state.updatedAt = new Date().toISOString();
      await writeState(state);
      return res.status(200).json({ ok: true, count: kept.length });
    }
    res.setHeader('Allow', 'POST, DELETE');
    return res.status(405).json({ error: 'Method not allowed' });
  } catch (e) {
    return res.status(e.status || 500).json({ error: e.status ? e.message : 'Server error', detail: String(e.message || e).slice(0, 200) });
  }
}
