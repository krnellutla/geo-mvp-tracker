/**
 * Sends every new Google Form response to the GEO tracker, so the Validation tab
 * updates on its own. No names or emails are involved: only the answer letters A to F.
 *
 * ONE-TIME SETUP (about 3 minutes)
 * 1. Open the survey form in edit mode. Choose the three-dot menu > Apps script.
 *    (This ties the script to the form. A standalone project also works: add a FORM_ID property below.)
 * 2. Paste this whole file, replacing any existing code. Save.
 * 3. Project Settings (gear icon) > Script properties > Add script property:
 *      TRACKER_URL  = https://geo.tinkeryard.dev
 *      INGEST_KEY   = the contents of your local .ingest-key file (never commit it)
 *      FORM_ID      = (only needed for a standalone project, otherwise leave out)
 * 4. In the editor choose the function  installTrigger  and press Run.
 *    Approve the permission prompt (it asks to see the form and to connect to an external service).
 * 5. Choose  syncAll  and press Run once. This sends responses submitted before the trigger existed.
 *    It is safe to run again: a response the tracker already has is not added twice, and any answer
 *    that was saved blank is filled in. Run it again after you edit a question or its options.
 *
 * To check it: submit the form yourself, then open the tracker's Validation tab within a minute.
 * To see what happened: Executions (left sidebar) lists each run with its log.
 */

var QUESTIONS = 10;

function getForm_() {
  var id = PropertiesService.getScriptProperties().getProperty('FORM_ID');
  return id ? FormApp.openById(id) : FormApp.getActiveForm();
}

/** Lower-case, trim and unify quotes, dashes and spaces so small wording or typing differences still match. */
function norm_(t) {
  return String(t == null ? '' : t).toLowerCase()
    .replace(/[\u2018\u2019\u201C\u201D]/g, "'").replace(/[\u2013\u2014]/g, '-')
    .replace(/\s+/g, ' ').trim();
}

/**
 * Pure function: turns one form response into the payload the tracker expects.
 * Each answer's letter is its position in the question's choice list (A = first choice).
 * itemResponses: array of { num, title, answer, choices }.
 *   num     = the question's position in the form (1 to 10). Position is used first because
 *             question titles can be edited; if num is missing, a leading "6." in the title is used.
 *   choices = the question's option texts, in order.
 */
function buildPayload_(formResponseId, submittedAt, itemResponses) {
  var answers = {}, unmatched = [];
  itemResponses.forEach(function (ir) {
    var n = ir.num;
    if (!n) {
      var m = /^\s*(\d+)\.\s/.exec(ir.title || '');
      n = m ? parseInt(m[1], 10) : 0;
    }
    if (n < 1 || n > QUESTIONS) return;
    var ans = Array.isArray(ir.answer) ? ir.answer[0] : ir.answer;
    var choices = ir.choices || [];
    var idx = choices.indexOf(ans);
    if (idx < 0) {
      var want = norm_(ans);
      for (var i = 0; i < choices.length; i++) if (norm_(choices[i]) === want) { idx = i; break; }
    }
    if (idx >= 0 && idx < 26) answers['q' + n] = String.fromCharCode(65 + idx);
    else unmatched.push('Q' + n + ': ' + ans);
  });
  return { formResponseId: formResponseId, submittedAt: submittedAt, answers: answers, unmatched: unmatched };
}

function choicesOf_(item) {
  var t = item.getType();
  if (t === FormApp.ItemType.MULTIPLE_CHOICE) return item.asMultipleChoiceItem().getChoices().map(function (c) { return c.getValue(); });
  if (t === FormApp.ItemType.LIST) return item.asListItem().getChoices().map(function (c) { return c.getValue(); });
  if (t === FormApp.ItemType.CHECKBOX) return item.asCheckboxItem().getChoices().map(function (c) { return c.getValue(); });
  return [];
}

function payloadFor_(response) {
  // question number = position among the form's answerable items, so retitling a question cannot break it
  var order = {}, n = 0;
  getForm_().getItems().forEach(function (item) {
    var t = item.getType();
    if (t === FormApp.ItemType.MULTIPLE_CHOICE || t === FormApp.ItemType.LIST || t === FormApp.ItemType.CHECKBOX) order[item.getId()] = ++n;
  });
  var items = response.getItemResponses().map(function (ir) {
    var item = ir.getItem();
    return { num: order[item.getId()], title: item.getTitle(), answer: ir.getResponse(), choices: choicesOf_(item) };
  });
  var p = buildPayload_(response.getId(), response.getTimestamp().toISOString(), items);
  if (p.unmatched.length) Logger.log('Could not match to a current option (left blank): ' + p.unmatched.join(' | '));
  delete p.unmatched; // the tracker only needs the letters
  return p;
}

function send_(payload) {
  var props = PropertiesService.getScriptProperties();
  var base = props.getProperty('TRACKER_URL');
  var key = props.getProperty('INGEST_KEY');
  if (!base || !key) throw new Error('Set TRACKER_URL and INGEST_KEY in Project Settings > Script properties.');
  var res = UrlFetchApp.fetch(base.replace(/\/$/, '') + '/api/survey', {
    method: 'post',
    contentType: 'application/json',
    headers: { 'x-ingest-key': key },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  });
  var code = res.getResponseCode();
  if (code !== 200) throw new Error('Tracker returned ' + code + ': ' + res.getContentText().slice(0, 200));
  return JSON.parse(res.getContentText());
}

/** Runs automatically on each new submission (installed by installTrigger). */
function onFormSubmit(e) {
  var out = send_(payloadFor_(e.response));
  Logger.log('Sent response ' + e.response.getId() + ' -> ' + JSON.stringify(out));
}

/** Run once: makes Google call onFormSubmit for every new response. */
function installTrigger() {
  var form = getForm_();
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'onFormSubmit') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('onFormSubmit').forForm(form).onFormSubmit().create();
  Logger.log('Trigger installed for: ' + form.getTitle());
}

/** Run once after setup to send existing responses. Safe to repeat. */
function syncAll() {
  var responses = getForm_().getResponses();
  var sent = 0, dup = 0;
  responses.forEach(function (r) {
    var out = send_(payloadFor_(r));
    if (out.duplicate) dup++; else sent++;
  });
  Logger.log('Responses on the form: ' + responses.length + '. Newly added: ' + sent + '. Already in the tracker (updated if answers changed): ' + dup + '.');
}

/** Optional check: sends nothing, prints what would be sent for the latest response. */
function previewLatest() {
  var responses = getForm_().getResponses();
  if (!responses.length) return Logger.log('No responses yet.');
  Logger.log(JSON.stringify(payloadFor_(responses[responses.length - 1])));
}

/**
 * Run this when answers come through blank. It sends nothing. It lists every item in the form, whether it
 * counts as a question, and for the latest response shows each answer, the choices, and whether they matched.
 * Open View > Logs (or Executions) afterwards and read the lines that say NO MATCH.
 */
function diagnose() {
  var MC = FormApp.ItemType.MULTIPLE_CHOICE, LIST = FormApp.ItemType.LIST, CB = FormApp.ItemType.CHECKBOX;
  var form = getForm_(), q = 0, order = {};
  Logger.log('Form: ' + form.getTitle() + ' | items: ' + form.getItems().length);
  form.getItems().forEach(function (item, i) {
    var t = item.getType(), isQ = (t === MC || t === LIST || t === CB);
    if (isQ) order[item.getId()] = ++q;
    Logger.log('item ' + (i + 1) + ' | type ' + t + ' | ' + (isQ ? 'question ' + q : 'not a question') + ' | ' + item.getTitle().slice(0, 70));
  });
  var rs = form.getResponses();
  if (!rs.length) return Logger.log('No responses yet.');
  var last = rs[rs.length - 1];
  Logger.log('Latest response ' + last.getId() + ' at ' + last.getTimestamp().toISOString() + ' | answered items: ' + last.getItemResponses().length);
  last.getItemResponses().forEach(function (ir) {
    var item = ir.getItem(), choices = choicesOf_(item), ans = Array.isArray(ir.getResponse()) ? ir.getResponse()[0] : ir.getResponse();
    var idx = choices.indexOf(ans);
    if (idx < 0) { var w = norm_(ans); for (var k = 0; k < choices.length; k++) if (norm_(choices[k]) === w) { idx = k; break; } }
    Logger.log('Q' + (order[item.getId()] || '?') + ' | answer: ' + JSON.stringify(ans) + ' | ' + (idx >= 0 ? 'matched letter ' + String.fromCharCode(65 + idx) : 'NO MATCH. Choices are: ' + JSON.stringify(choices)));
  });
}
