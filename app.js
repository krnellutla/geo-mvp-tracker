'use strict';
/* ---------- helpers ---------- */
const $ = (id) => document.getElementById(id);
const el = (tag, props = {}, ...kids) => {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === 'class') n.className = v;
    else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
    else if (k.includes('-') || k === 'role') { if (v !== undefined && v !== null && v !== false) n.setAttribute(k, v); }
    else if (v !== undefined && v !== null && v !== false) n[k] = v;
  }
  for (const k of kids.flat()) if (k != null && k !== false) n.append(k.nodeType ? k : document.createTextNode(String(k)));
  return n;
};
const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { /* private mode */ } },
  del(k) { try { localStorage.removeItem(k); } catch { /* private mode */ } },
};
const iso = (d) => d.toISOString().slice(0, 10);
const TODAY = iso(new Date());
const fmt = (s, o = { day: 'numeric', month: 'short' }) => new Date(s + 'T00:00:00').toLocaleDateString('en-GB', o);
const STATUSES = [['todo', 'To do'], ['doing', 'Doing'], ['blocked', 'Blocked'], ['done', 'Done']];
const norm = (s) => (s === 'partial' ? 'doing' : STATUSES.some(([k]) => k === s) ? s : 'todo');
const pill = (s, label) => el('span', { class: 'pill p-' + s }, label || s);
const list = (items, tag = 'ul') => el(tag, {}, items.map((t) => el('li', {}, t)));
const box = (h, body) => el('div', { class: 'card' }, el('p', { class: 'lead' }, h), typeof body === 'string' ? el('div', {}, body) : body);

/* ---------- state ---------- */
const S = { base: null, ov: {}, mode: 'loading', canEdit: false, key: store.get('geo-key') || '', tab: 'board', week: 'all', saveTimer: null, saveMsg: '' };
const emptyOv = () => ({ plan: {}, gates: {}, deliverables: {}, survey: [], interviews: [], audits: [] });

function view() {
  const b = S.base, o = S.ov;
  const plan = b.plan.map((p) => {
    const x = (o.plan || {})[p.day] || {};
    return { ...p, status: norm(x.status ?? p.status), evidence: x.evidence ?? p.evidence ?? '', note: x.note || '' };
  });
  return {
    plan,
    gates: b.gates.map((g) => ({ ...g, ...((o.gates || {})[g.id] || {}) })),
    deliverables: b.deliverables.map((d) => ({ ...d, ...((o.deliverables || {})[d.name] || {}) })),
    observation: { ...b.observation, ...(o.observation || {}) },
    verdict: { ...b.verdict, ...(o.verdict || {}) },
    survey: [...(o.survey || []), ...(o.formResponses || [])], interviews: o.interviews || [], audits: o.audits || [],
  };
}
const isLate = (p) => p.date < TODAY && p.status !== 'done';
const dayNo = () => Math.min(21, Math.max(0, Math.round((new Date(TODAY) - new Date(S.base.meta.start)) / 86400000) + 1));

/* ---------- persistence ---------- */
function setSave(msg, err) { S.saveMsg = msg; const n = $('saveState'); n.textContent = msg; n.className = 'save' + (err ? ' err' : ''); }
function toast(msg) { const t = $('toast'); t.textContent = msg; t.hidden = false; clearTimeout(toast.t); toast.t = setTimeout(() => (t.hidden = true), 3200); }

function queueSave() {
  setSave('Saving…');
  clearTimeout(S.saveTimer);
  S.saveTimer = setTimeout(async () => {
    if (S.mode === 'local') { store.set('geo-ov', JSON.stringify(S.ov)); return setSave('Saved in this browser ' + new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })); }
    try {
      const r = await fetch('/api/state', { method: 'PUT', headers: { 'content-type': 'application/json', 'x-edit-key': S.key }, body: JSON.stringify({ ...S.ov, formResponses: undefined }) });
      if (r.status === 401) { lock(); return setSave('Edit key rejected. Unlock again.', true); }
      if (!r.ok) throw new Error((await r.json()).error || r.status);
      setSave('Saved ' + new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }));
    } catch (e) { setSave('Not saved: ' + e.message, true); toast('Could not save. Your change is still on screen; try again.'); }
  }, 500);
}
const edit = (fn) => { if (!S.canEdit) return toast('Unlock editing to change the board.'); fn(S.ov); queueSave(); render(); };

async function load() {
  S.base = await (await fetch('data/tracker.json', { cache: 'no-cache' })).json();
  S.ov = emptyOv();
  try {
    const r = await fetch('/api/state', { cache: 'no-store', headers: S.key ? { 'x-edit-key': S.key } : {} });
    if (!r.ok || !(r.headers.get('content-type') || '').includes('json')) throw new Error('no api');
    const j = await r.json();
    S.mode = 'server'; S.canEdit = !!j.canEdit;
    if (S.key && !j.canEdit) { store.del('geo-key'); S.key = ''; }
    S.ov = { ...emptyOv(), ...j }; delete S.ov.canEdit;
    setSave(j.updatedAt ? 'Last saved ' + new Date(j.updatedAt).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : 'No edits saved yet');
  } catch {
    S.mode = 'local'; S.canEdit = true;
    try { S.ov = { ...emptyOv(), ...JSON.parse(store.get('geo-ov') || '{}') }; } catch { S.ov = emptyOv(); }
    setSave('Local mode');
  }
  chrome(); route(); render();
}

/* ---------- lock / unlock ---------- */
function lock() { S.canEdit = false; S.key = ''; store.del('geo-key'); chrome(); render(); }
function chrome() {
  const b = S.base;
  $('tagline').textContent = b.meta.title + ' by ' + b.meta.author + ', ' + fmt(b.meta.start) + ' to ' + fmt(b.meta.end, { day: 'numeric', month: 'short', year: 'numeric' });
  const lb = $('lockBtn');
  lb.textContent = S.mode === 'local' ? 'Local edit mode' : S.canEdit ? 'Lock editing' : 'Unlock editing';
  lb.disabled = S.mode === 'local';
  const ban = $('banner');
  ban.hidden = S.mode !== 'local';
  ban.textContent = 'Local mode: the save service is not reachable, so edits stay in this browser only.';
}
$('lockBtn').addEventListener('click', () => { if (S.canEdit) { lock(); toast('Editing locked.'); } else { $('keyErr').hidden = true; $('keyInput').value = ''; $('unlock').showModal(); $('keyInput').focus(); } });
$('unlockForm').addEventListener('submit', async (e) => {
  if (e.submitter && e.submitter.value !== 'ok') return;
  e.preventDefault();
  const k = $('keyInput').value.trim();
  const r = await fetch('/api/state', { cache: 'no-store', headers: { 'x-edit-key': k } }).then((x) => x.json()).catch(() => ({}));
  if (r.canEdit) { S.key = k; S.canEdit = true; store.set('geo-key', k); $('unlock').close(); chrome(); render(); toast('Editing unlocked.'); }
  else { $('keyErr').textContent = 'That key does not match. Check it and try again.'; $('keyErr').hidden = false; }
});

/* ---------- tabs ---------- */
const TABS = [['board', 'Board'], ['overview', 'Overview'], ['evidence', 'Evidence'], ['validation', 'Validation'], ['method', 'Method'], ['verdict', 'Verdict']];
function route() { const h = location.hash.slice(1); if (TABS.some(([k]) => k === h)) S.tab = h; }
window.addEventListener('hashchange', () => { route(); render(); });
function renderTabs() {
  const v = view();
  const counts = { board: v.plan.filter((p) => isLate(p)).length || '', validation: (v.survey.length + v.interviews.length + v.audits.length) || '' };
  const nav = $('tabs'); nav.replaceChildren();
  TABS.forEach(([k, label]) => nav.append(el('button', { class: 'tab', role: 'tab', id: 'tab-' + k, 'aria-selected': String(S.tab === k), onclick: () => { location.hash = k; },
    onkeydown: (e) => { const i = TABS.findIndex(([x]) => x === S.tab); if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') { e.preventDefault(); location.hash = TABS[(i + (e.key === 'ArrowRight' ? 1 : TABS.length - 1)) % TABS.length][0]; setTimeout(() => $('tab-' + S.tab).focus()); } } },
    label, counts[k] ? el('span', { class: 'n', title: k === 'board' ? 'Days behind' : 'Entries logged' }, counts[k]) : null)));
}

function render() {
  if (!S.base) return;
  renderTabs();
  const m = $('view'); m.replaceChildren();
  m.setAttribute('role', 'tabpanel'); m.setAttribute('aria-labelledby', 'tab-' + S.tab);
  ({ board: rBoard, overview: rOverview, evidence: rEvidence, validation: rValidation, method: rMethod, verdict: rVerdict })[S.tab](m, view());
}

/* ---------- board ---------- */
function rBoard(m, v) {
  const late = v.plan.filter(isLate).length, done = v.plan.filter((p) => p.status === 'done').length, doing = v.plan.filter((p) => p.status === 'doing').length;
  m.append(el('div', { class: 'pane-head' },
    el('div', {}, el('p', { class: 'lead' }, 'Day ' + dayNo() + ' of 21, ' + fmt(TODAY, { weekday: 'long', day: 'numeric', month: 'long' })), el('h2', {}, done + ' done, ' + doing + ' doing, ' + late + ' behind')),
    el('div', { class: 'filters' }, [['all', 'All weeks'], ['1', 'Week 1'], ['2', 'Week 2'], ['3', 'Week 3']].map(([k, l]) => el('button', { class: 'chip', 'aria-pressed': String(S.week === k), onclick: () => { S.week = k; render(); } }, l)))));

  // day ruler
  const ruler = el('div', { class: 'ruler', role: 'list', 'aria-label': '21-day timeline' });
  v.plan.forEach((p) => {
    const st = isLate(p) && p.status === 'todo' ? 'behind' : p.status;
    ruler.append(el('button', { class: 'tick ' + st + (p.date === TODAY ? ' today' : '') + ((p.day - 1) % 7 === 0 && p.day > 1 ? ' wk' : ''), role: 'listitem', title: 'Day ' + p.day + ' · ' + fmt(p.date) + ' · ' + st, 'aria-label': 'Day ' + p.day + ', ' + st, onclick: () => openCard(p.day) }, String(p.day)));
  });
  m.append(ruler, el('div', { class: 'ruler-key' }, [['var(--ok)', 'Done'], ['#e9b44c', 'Doing'], ['var(--bad)', 'Blocked'], ['var(--bad-soft)', 'Behind, not started'], ['var(--todo)', 'Upcoming']].map(([c, l]) => el('span', {}, el('i', { style: 'background:' + c }), l))));

  const board = el('div', { class: 'board' });
  STATUSES.forEach(([st, label]) => {
    const cards = v.plan.filter((p) => p.status === st && (S.week === 'all' || String(p.week) === S.week));
    const col = el('div', { class: 'col c-' + st, ondragover: (e) => { if (S.canEdit) { e.preventDefault(); col.classList.add('over'); } }, ondragleave: () => col.classList.remove('over'),
      ondrop: (e) => { e.preventDefault(); col.classList.remove('over'); const d = Number(e.dataTransfer.getData('text/plain')); if (d) moveCard(d, st); } },
      el('div', { class: 'col-h' }, el('h3', {}, el('i'), label), el('span', {}, String(cards.length))));
    if (!cards.length) col.append(el('div', { class: 'empty' }, st === 'done' ? 'Nothing done yet. Move a card here once it has evidence.' : 'No cards'));
    cards.forEach((p) => col.append(card(p)));
    board.append(col);
  });
  m.append(board, el('p', { class: 'muted', style: 'font-size:.82rem;margin-top:10px' }, S.canEdit ? 'Drag a card to another column, or open it to change its status. A card can move to Done only when it has evidence.' : 'Read-only view. Unlock editing (top right) to move cards and add evidence.'));
}
function card(p) {
  const b = [];
  if (p.date === TODAY) b.push(el('span', { class: 'b today' }, 'today'));
  if (isLate(p)) b.push(el('span', { class: 'b late' }, Math.round((new Date(TODAY) - new Date(p.date)) / 86400000) + 'd late'));
  b.push(p.evidence ? el('span', { class: 'b ev' }, 'evidence') : p.status === 'done' ? el('span', { class: 'b noev' }, 'no evidence') : null);
  return el('button', { class: 'kc s-' + p.status, draggable: S.canEdit, 'data-day': p.day,
    ondragstart: (e) => { e.dataTransfer.setData('text/plain', String(p.day)); e.dataTransfer.effectAllowed = 'move'; e.currentTarget.classList.add('drag'); },
    ondragend: (e) => e.currentTarget.classList.remove('drag'), onclick: () => openCard(p.day) },
    el('span', { class: 'top' }, el('b', {}, 'Day ' + p.day), el('span', {}, fmt(p.date))),
    el('span', { class: 't' }, p.title), el('span', { class: 'o' }, 'Planned output: ' + p.output), el('span', { class: 'badges' }, b));
}
function moveCard(day, st) {
  const p = view().plan.find((x) => x.day === day);
  if (!p || p.status === st) return;
  if (st === 'done' && !p.evidence.trim()) { toast('Add evidence before marking Day ' + day + ' done.'); return openCard(day, true); }
  edit((o) => { o.plan = o.plan || {}; o.plan[day] = { ...(o.plan[day] || {}), status: st, evidence: p.evidence }; });
}
function openCard(day, focusEvidence) {
  const p = view().plan.find((x) => x.day === day), dr = $('drawer'), ro = !S.canEdit;
  const sel = el('select', { disabled: ro }, STATUSES.map(([k, l]) => el('option', { value: k, selected: k === p.status }, l)));
  const ev = el('textarea', { value: p.evidence, disabled: ro, placeholder: 'What exists now that did not before? Link, file, count or quote.' });
  const note = el('textarea', { value: p.note, disabled: ro, placeholder: 'Optional: blockers, next step.' });
  const err = el('p', { class: 'err', hidden: true });
  const form = el('form', { class: 'dlg', method: 'dialog', onsubmit: (e) => {
    if (e.submitter && e.submitter.value !== 'save') return;
    e.preventDefault();
    if (sel.value === 'done' && !ev.value.trim()) { err.textContent = 'Done needs evidence. Write what exists now, or choose another status.'; err.hidden = false; return ev.focus(); }
    edit((o) => { o.plan = o.plan || {}; o.plan[day] = { status: sel.value, evidence: ev.value.trim(), note: note.value.trim() }; });
    dr.close();
  } },
    el('p', { class: 'meta' }, 'Day ' + p.day + ', ' + fmt(p.date, { weekday: 'long', day: 'numeric', month: 'long' }) + ', week ' + p.week),
    el('h2', { id: 'dTitle' }, p.title), el('p', { class: 'muted' }, 'Planned output: ' + p.output),
    el('label', {}, 'Status', sel), el('label', {}, 'Evidence', ev), el('label', {}, 'Note', note), err,
    el('div', { class: 'row' }, el('button', { class: 'btn ghost', value: 'close', formnovalidate: true }, ro ? 'Close' : 'Cancel'), ro ? null : el('button', { class: 'btn', value: 'save' }, 'Save card')));
  dr.replaceChildren(form); dr.showModal();
  if (focusEvidence) ev.focus();
}

/* ---------- overview ---------- */
function rOverview(m, v) {
  const done = v.plan.filter((p) => p.status === 'done').length, doing = v.plan.filter((p) => p.status === 'doing').length;
  const pct = Math.round(((done + doing * 0.5) / 21) * 100), pass = v.gates.filter((g) => g.status === 'pass').length;
  m.append(el('div', { class: 'pane-head' }, el('div', {}, el('p', { class: 'lead' }, 'Where the plan stands today'), el('h2', {}, 'Overview'))));
  const stats = [[dayNo() + ' / 21', 'Day'], [done, 'Cards done'], [v.plan.filter(isLate).length, 'Days behind'], [v.survey.length, 'Survey responses'], [v.interviews.length + ' / 3', 'Real conversations'], [v.audits.length, 'Audits delivered'], [pass + ' / ' + v.gates.length, 'Gates passed']];
  m.append(el('div', { class: 'grid g4' }, stats.map(([b, s]) => el('div', { class: 'stat' }, el('b', {}, b), el('span', {}, s)))),
    el('div', { class: 'bar-track', role: 'img', 'aria-label': pct + ' percent' }, el('span', { style: 'width:' + pct + '%' })), el('p', { class: 'muted', style: 'font-size:.82rem' }, pct + '% of the plan, counting Doing cards as half.'));
  m.append(el('h3', {}, 'Deliverables'), el('div', { class: 'grid g3' }, v.deliverables.map((d) => {
    const s = el('select', { disabled: !S.canEdit, onchange: () => edit((o) => { o.deliverables = o.deliverables || {}; o.deliverables[d.name] = { status: s.value }; }) },
      ['pending', 'draft', 'progress', 'provisional', 'done'].map((k) => el('option', { value: k, selected: k === d.status }, k)));
    return el('div', { class: 'card' }, el('p', { class: 'lead' }, pill(d.status)), el('h4', {}, d.name), el('p', { class: 'muted', style: 'font-size:.85rem' }, d.note), S.canEdit ? s : null);
  })));
  m.append(el('h3', {}, 'Success gates'), el('p', { class: 'muted' }, 'Pass or fail by Day 21, with arithmetic.'),
    el('div', { class: 'grid g2' }, v.gates.map((g) => {
      const s = el('select', { disabled: !S.canEdit, 'aria-label': g.id + ' status', onchange: () => edit((o) => { o.gates = o.gates || {}; o.gates[g.id] = { ...(o.gates[g.id] || {}), status: s.value }; }) }, ['open', 'pass', 'fail'].map((k) => el('option', { value: k, selected: k === g.status }, k)));
      const cur = el('textarea', { value: g.current, disabled: !S.canEdit, onchange: () => edit((o) => { o.gates = o.gates || {}; o.gates[g.id] = { ...(o.gates[g.id] || {}), current: cur.value }; }) });
      return el('div', { class: 'card' }, el('p', { class: 'lead' }, g.id), el('h4', {}, g.name), el('p', { style: 'font-size:.85rem' }, el('b', {}, 'Bar: '), g.bar), el('label', {}, 'Current', cur), el('label', {}, 'Status', s));
    })));
}

/* ---------- evidence ---------- */
function table(head, rows, empty, action) {
  const t = el('table', {}, el('thead', {}, el('tr', {}, head.map((h) => el('th', {}, h)))));
  const tb = el('tbody');
  if (!rows.length) tb.append(el('tr', {}, el('td', { class: 'none', colSpan: head.length }, empty)));
  rows.forEach((r) => tb.append(el('tr', {}, r.map((c) => el('td', {}, c)))));
  t.append(tb); return el('div', { class: 'tw' }, t);
}
function rEvidence(m, v) {
  const d = S.base.discovery, h = S.base.hypothesis, u = S.base.user;
  m.append(el('div', { class: 'pane-head' }, el('div', {}, el('p', { class: 'lead' }, 'What we observed, what we believe, and what we found'), el('h2', {}, 'Evidence'))));
  const t = el('textarea', { value: v.observation.text, disabled: !S.canEdit, style: 'min-height:170px' });
  const fl = el('input', { value: v.observation.status, disabled: !S.canEdit });
  m.append(el('h3', {}, 'Observation'), el('p', { class: 'flag' }, v.observation.status),
    S.canEdit ? el('div', { class: 'card' }, el('label', {}, 'Observation (replace the draft with a real person after your interviews)', t), el('label', {}, 'Status line', fl),
      el('div', { class: 'row' }, el('button', { class: 'btn', onclick: () => edit((o) => { o.observation = { text: t.value, status: fl.value }; toast('Observation saved.'); }) }, 'Save observation')))
      : el('blockquote', {}, v.observation.text),
    el('div', { class: 'grid g2' }, box('What breaks', S.base.observation.breaks), box('Cost today', S.base.observation.cost)));
  m.append(el('h3', {}, 'Subject'), el('div', { class: 'grid g3' }, box('Who', u.who), box('Context', u.context), box('Not the user (yet)', u.not_user)));
  m.append(el('h3', {}, 'Hypothesis'), el('p', {}, h.statement), el('div', { class: 'grid g2' }, box('Original pass bar', h.pass_bar_original), box('Current pass bar', h.pass_bar_current)),
    el('h3', {}, 'What would prove us wrong'), list(h.falsifiers, 'ol'),
    el('h3', {}, 'Decision criteria'), list(h.decision_criteria), el('h3', {}, 'Commitment, defined'), el('p', {}, h.commitment_definition), el('h3', {}, 'Pass-bar change log'), list(h.pass_bar_log));
  m.append(el('h3', {}, 'Method'), el('p', {}, d.method));
  m.append(el('h3', {}, 'Evidence base at a glance'), table(['Source', 'Real or not', 'Used for'], d.evidence_matrix.map((x) => [x.source, x.real, x.used])));
  m.append(el('h3', {}, 'Evidence register'), el('p', { class: 'muted' }, 'Every number used, where it came from, and how far to trust it.'), table(['Claim', 'Source', 'Type', 'Use'], d.evidence_register.map((x) => [x.claim, x.source, x.type, x.use])));
  m.append(el('h3', {}, 'Market scan'), table(['Player', 'Signal', 'Built for'], d.market.map((x) => [x.player, x.signal, x.built_for])), el('p', {}, d.market_read));
  const ai = d.adviser_input, inf = d.industry_focus, pp = d.pilot_plan, ue = d.unit_economics;
  m.append(el('h3', {}, 'Advice received and what changed'), el('p', { class: 'muted' }, ai.who + '. ' + ai.date + '. ' + ai.form + '.'), el('p', {}, ai.status),
    table(['Recommendation', 'Decision', 'What changed'], ai.changes.map((x) => [x.rec, pill(x.decision === 'Adopted' ? 'done' : x.decision === 'Not started' || x.decision === 'Noted' ? 'open' : 'doing', x.decision), x.what]), ''),
    el('p', { class: 'muted' }, d.verification_note),
    el('h3', {}, 'Deck revisions'), el('p', { class: 'muted' }, d.deck_revisions.date + '. ' + d.deck_revisions.intro), list(d.deck_revisions.changes));
  m.append(el('h3', {}, 'Industry focus'), el('p', {}, inf.starting_customer), table(['Rank', 'Industry and starting segment', 'Assessment'], inf.rows.map((x) => [x.rank, x.industry, x.assessment]), ''), el('p', { class: 'muted' }, inf.note));
  m.append(el('h3', {}, 'Pilot plan'), el('p', { class: 'muted' }, pp.note), table(['When', 'Activity', 'Output'], pp.stages.map((x) => [x.when, x.activity, x.output]), ''));
  m.append(el('h3', {}, 'Measurement rules'), list(d.measurement_rules));
  m.append(el('h3', {}, 'Unit economics, calculated'), table(['Calculation', 'Result'], ue.rows, ''), el('p', { class: 'muted' }, ue.note));
  m.append(el('h3', {}, 'Build order'), table(['When', 'Build or improve', 'Why'], d.build_order.map((x) => [x.when, x.what, x.why]), ''));
  m.append(el('h3', {}, 'Research gaps and where they fit'), table(['Gap', 'What it is', 'Fit with the MVP'], d.research_gaps.map((x) => [x.gap, x.what, x.fit])), el('p', { class: 'muted' }, d.caution));
  m.append(el('div', { class: 'grid g2' }, box('Business model', list(d.business_model.map((x) => x.stage + ': ' + x.what))), box('Roadmap: automate only what is done by hand', list(d.roadmap.map((x) => x.phase + ': ' + x.what)))),
    el('h3', {}, 'Pilot offer'), el('div', { class: 'grid g2' }, box('You give', list(d.pilot_offer.you_give)), box('You get', list(d.pilot_offer.you_get))),
    el('h3', {}, 'What we won’t claim'), list(d.wont_claim));
}

/* ---------- validation ---------- */
const inSegment = (r) => ['A', 'B'].includes(r.q1) && r.q2 === 'A';
const isStrong = (r) => inSegment(r) && ['A', 'B'].includes(r.q4) && r.q10 === 'B';
const delBtn = (arr, i, name) => (S.canEdit ? el('button', { class: 'btn small danger', 'aria-label': 'Remove ' + name, onclick: () => { if (confirm('Remove this entry?')) edit((o) => o[arr].splice(i, 1)); } }, 'Remove') : '');
function rValidation(m, v) {
  const manualN = (S.ov.survey || []).length, formN = (S.ov.formResponses || []).length;
  const sv = S.base.validation.survey, rs = v.survey, pc = (f) => (rs.length ? Math.round((rs.filter(f).length / rs.length) * 100) + '%' : 'n/a');
  m.append(el('div', { class: 'pane-head' }, el('div', {}, el('p', { class: 'lead' }, 'What people told us, and what has been delivered'), el('h2', {}, 'Validation log')),
    el('a', { class: 'btn ghost small', href: S.base.meta.survey_link, target: '_blank', rel: 'noopener', style: 'color:inherit' }, 'Open the survey form')));
  m.append(el('p', {}, sv.purpose + ' Strong lead: ' + sv.strong_lead_rule));
  m.append(el('div', { class: 'grid g4' }, [[rs.length, 'Responses'], [rs.filter(inSegment).length, 'In the target segment (Q1 A or B, Q2 A)'], [pc((r) => ['A', 'B'].includes(r.q4)), 'Leadership asked (Q4 A or B)'], [pc((r) => r.q7 === 'B'), 'Report by screenshots (Q7 B)'], [pc((r) => r.q10 === 'B'), 'Approved a S$100 to 500 tool alone (Q10 B)'], [rs.filter(isStrong).length, 'Strong leads']].map(([b, s]) => el('div', { class: 'stat' }, el('b', {}, b), el('span', {}, s)))));
  m.append(el('p', { class: 'flag', style: 'margin-top:12px' }, 'This page is public. Log people by role and company type, never by name.'));

  // survey
  m.append(el('h3', {}, 'Survey responses'), el('p', { class: 'muted', id: 'liveNote' }, S.mode === 'server' ? 'Answers from the Google Form appear here automatically, usually within a minute. ' + formN + ' so far.' : 'Live form feed is available on the published site.'), table(['Respondent', ...Array.from({ length: 10 }, (_, i) => 'Q' + (i + 1)), 'Strong', ''], rs.map((r, i) => [r.id, ...Array.from({ length: 10 }, (_, j) => r['q' + (j + 1)] || ''), isStrong(r) ? 'Yes' : 'No', i < manualN ? delBtn('survey', i, r.id) : el('span', { class: 'muted' }, 'From the form')]), 'No responses logged yet.'));
  if (S.canEdit) {
    const sels = sv.questions.map((q) => { const opts = q.options.split(' · '); return el('label', {}, 'Q' + q.n + ' ' + q.q, el('select', { required: true }, el('option', { value: '' }, 'Choose'), opts.map((o) => el('option', { value: o.slice(0, 1) }, o)))); });
    m.append(el('details', { class: 'add' }, el('summary', {}, 'Add a survey response'), el('form', { onsubmit: (e) => { e.preventDefault(); const row = { id: 'R' + (manualN + 1) }; sels.forEach((l, i) => (row['q' + (i + 1)] = l.querySelector('select').value)); edit((o) => o.survey.push(row)); toast('Response added.'); } },
      el('div', { class: 'form-grid', style: 'margin-top:10px' }, sels), el('div', { class: 'row' }, el('button', { class: 'btn' }, 'Add response')))));
  }
  const dist = sv.questions.map((q) => {
    const opts = q.options.split(' · ').map((o) => o.replace(/^[A-F]\.\s*/, '')), key = 'q' + q.n;
    const cells = opts.map((o, k) => [o, rs.filter((r) => r[key] === String.fromCharCode(65 + k)).length]);
    const blank = rs.filter((r) => !r[key]).length;
    return [q.n, q.q, el('div', {}, cells.filter(([, c]) => c).map(([o, c]) => el('div', {}, o + ': ' + c)), blank ? el('div', { class: 'muted' }, 'No answer recorded: ' + blank) : null, !rs.length ? el('span', { class: 'muted' }, 'No responses yet') : null)];
  });
  m.append(el('h3', {}, 'What the responses say so far'), el('p', { class: 'muted' }, 'Counts per answer. This is a small group of friends and contacts, so read it as a screener, not as evidence of demand.'), table(['#', 'Question', 'Answers'], dist, ''));
  m.append(el('h3', {}, 'Survey questions'), table(['#', 'Question', 'Options', 'What it tests'], sv.questions.map((q) => [q.n, q.q, el('div', {}, q.options.split(' · ').map((x) => el('div', {}, x))), q.tests])), el('p', { class: 'muted', style: 'font-size:.84rem' }, sv.reading_rule + ' ' + sv.tally_note), el('h3', {}, 'Known gaps in the survey'), list(sv.known_gaps));

  // interviews
  m.append(el('h3', {}, 'Interview script'), list(S.base.validation.interview_script, 'ol'),
    el('h3', {}, 'Interviews'), table(['Date', 'Person (role, company type)', 'Trigger in their words', 'What they did', 'Reported how', 'S$300?', 'Notes', ''], v.interviews.map((x, i) => [x.date, x.person, x.trigger, x.did, x.reported, x.rerun, x.notes || '', delBtn('interviews', i, 'interview')]), 'No interviews logged yet.'));
  if (S.canEdit) m.append(formBlock('Add an interview', [['date', 'Date', 'date', TODAY], ['person', 'Person (role, company type)', 'text'], ['trigger', 'Trigger, in their words', 'textarea'], ['did', 'What they did', 'textarea'], ['reported', 'How they reported it', 'text'], ['rerun', 'S$300 re-run?', ['Yes', 'No', 'Maybe', 'Not asked']], ['notes', 'Notes (optional): what it shows, and what it does not', 'textarea', '', true]], (row) => edit((o) => o.interviews.push(row))));

  // audits
  m.append(el('h3', {}, 'Audits delivered'), table(['Date', 'Company type', 'Citation Share', 'Used in a report?', 'Committed to S$300?', ''], v.audits.map((x, i) => [x.date, x.company, x.share, x.used, x.committed, delBtn('audits', i, 'audit')]), 'No audits delivered yet.'));
  if (S.canEdit) m.append(formBlock('Add an audit', [['date', 'Date', 'date', TODAY], ['company', 'Company type', 'text'], ['share', 'Citation Share (for example 17%)', 'text'], ['used', 'Used in a report?', ['Yes', 'No', 'Not yet']], ['committed', 'Committed to S$300?', ['Yes', 'No', 'Maybe']]], (row) => edit((o) => o.audits.push(row))));
  m.append(el('h3', {}, 'Limitations'), list(S.base.validation.limitations));
}
function formBlock(title, fields, onAdd) {
  const inputs = fields.map(([k, label, type, def, optional]) => {
    const c = Array.isArray(type) ? el('select', { required: true }, type.map((o) => el('option', { value: o }, o))) : type === 'textarea' ? el('textarea', { required: !optional }) : el('input', { type, required: true, value: def || '' });
    c.name = k; return el('label', {}, label, c);
  });
  return el('details', { class: 'add' }, el('summary', {}, title), el('form', { onsubmit: (e) => { e.preventDefault(); const row = {}; inputs.forEach((l) => { const c = l.lastChild; row[c.name] = c.value.trim(); }); onAdd(row); toast('Added.'); } },
    el('div', { class: 'form-grid', style: 'margin-top:10px' }, inputs), el('div', { class: 'row' }, el('button', { class: 'btn' }, 'Add entry'))));
}

/* ---------- method ---------- */
function rMethod(m) {
  const ip = S.base.ipo, g = S.base.golden_set;
  m.append(el('div', { class: 'pane-head' }, el('div', {}, el('p', { class: 'lead' }, 'How one audit runs, from input to report'), el('h2', {}, 'Method'))), el('p', { class: 'flag' }, 'Why this is a manual MVP'), el('p', {}, S.base.manual_note));
  m.append(el('div', { class: 'grid g3' }, box('Input', list(ip.input)), box('Process', list(ip.process, 'ol')), box('Output', list(ip.output))), el('p', { class: 'muted' }, ip.note));
  m.append(el('h3', {}, 'Golden set and grading'), el('p', {}, g.summary), el('div', { class: 'grid g2' }, box('Label rule', list(g.label_rule)), box('Plan grading rule: passes if it does all five', list(g.grading_rule, 'ol'))),
    el('p', {}, el('b', {}, 'Target: '), g.target), list(g.open_items));
}

/* ---------- verdict ---------- */
function rVerdict(m, v) {
  const vd = v.verdict, base = S.base.verdict;
  m.append(el('div', { class: 'pane-head' }, el('div', {}, el('p', { class: 'lead' }, 'Where the evidence points as of ' + fmt(vd.as_of, { day: 'numeric', month: 'long', year: 'numeric' })), el('h2', {}, 'Verdict'))));
  m.append(el('div', { class: 'verdict' }, el('strong', {}, vd.current), el('p', {}, vd.reason), el('p', {}, el('b', {}, 'Next: '), vd.next)));
  if (S.canEdit) {
    const c = el('input', { value: vd.current }), r = el('textarea', { value: vd.reason }), n = el('textarea', { value: vd.next });
    m.append(el('details', { class: 'add' }, el('summary', {}, 'Update the verdict'), el('div', { style: 'margin-top:10px' }, el('label', {}, 'Verdict', c), el('label', {}, 'Reason', r), el('label', {}, 'Next action', n),
      el('div', { class: 'row' }, el('button', { class: 'btn', onclick: () => edit((o) => { o.verdict = { current: c.value, reason: r.value, next: n.value, as_of: TODAY }; toast('Verdict updated.'); }) }, 'Save verdict')))));
  }
  m.append(el('h3', {}, 'Submission summary'), list(vd.summary), el('h3', {}, 'Decision rules'), el('div', { class: 'grid g3' }, base.rules.map((x) => box(x.call, x.when))),
    el('h3', {}, 'By dimension'), table(['Dimension', 'Verdict'], base.dimensions.map((x) => [x.dimension, x.verdict])));
  m.append(el('h3', {}, 'Submission'), el('div', { class: 'row', style: 'justify-content:flex-start' },
    el('a', { class: 'btn', href: 'GEO-Audit-Submission.pdf', target: '_blank', rel: 'noopener' }, 'Download the submission PDF'),
    el('button', { class: 'btn ghost', onclick: exportData }, 'Export current data (JSON)')),
    el('p', { class: 'muted', style: 'font-size:.84rem' }, 'The PDF is rebuilt from the saved board, so it can lag behind edits made here. ' + S.base.meta.evidence_boundary));
}
function exportData() {
  const blob = new Blob([JSON.stringify({ exportedAt: new Date().toISOString(), state: S.ov }, null, 2)], { type: 'application/json' });
  const a = el('a', { href: URL.createObjectURL(blob), download: 'geo-tracker-state-' + TODAY + '.json' }); document.body.append(a); a.click(); a.remove();
}

/* ---------- live form feed ---------- */
async function pollForm() {
  if (S.mode !== 'server' || document.hidden || !S.base) return;
  const a = document.activeElement;
  if (a && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName)) return; // never re-render while someone is typing
  try {
    const j = await (await fetch('/api/state', { cache: 'no-store' })).json();
    const next = j.formResponses || [], cur = S.ov.formResponses || [];
    if (next.length !== cur.length) {
      S.ov.formResponses = next;
      render();
      toast(next.length > cur.length ? 'New survey response received.' : 'Survey responses updated.');
    }
  } catch { /* offline: try again next time */ }
}
setInterval(pollForm, 30000);
document.addEventListener('visibilitychange', pollForm);

load().catch((e) => { $('view').textContent = 'Could not load the tracker data: ' + e.message; });
