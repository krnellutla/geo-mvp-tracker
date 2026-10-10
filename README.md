# GEO MVP tracker

A progress tracker for a 21-day manual MVP. It shows the plan as a kanban board, collects the validation evidence, and produces the submission PDF, so progress is shown with evidence rather than claimed.

It tracks the **AI Visibility Audit**. The audit tool itself, the final MVP, lives in a separate repo: [`geo-audit`](https://github.com/krnellutla/geo-audit). This repo only tracks how the MVP is going.

**Live:** https://geo.tinkeryard.dev

## What it tracks
- **Board:** each of the 21 days is a card. A card can move to Done only when it carries evidence.
- **Validation:** survey responses arrive live from a Google Form. Interviews and audits are logged by hand.
- **Gates and verdict:** six pass or fail gates with arithmetic bars, and a dated verdict.
- **Submission:** `GEO-Audit-Submission.pdf` is built from the live board, so the site and the PDF cannot disagree.

## How it works
```
Google Form --(Apps Script, ingest key)--> /api/survey --\
                                                          +--> Vercel Blob --> tracker page
You (edit key) ---------------------------> /api/state --/                      + submission PDF
```
- Static front end (`index.html`, `style.css`, `app.js`) reading `data/tracker.json`, plus three small functions in `api/`.
- Visitors see the board read-only. Edits need the edit key.
- Form responses use a separate ingest key that can only add survey rows, so the edit key never lives in Google.
- Every save writes a new Blob file and readers use the newest. Overwriting one file did not work because the CDN kept serving the old copy. The last five versions are kept.

## Repo layout
```
index.html style.css app.js     the page
data/tracker.json               plan, evidence register, gates, verdict text
api/                            state.js (save), survey.js (form feed), _store.js (Blob helpers)
google-form/                    create-google-form.gs, form-to-tracker.gs
scripts/build_pdf.py            builds the submission PDF
docs/                           NORTHSTAR.md, PLAN-21-DAYS.md, validation-log.md
GEO-Audit-Submission.pdf        the built submission, served by the site
```

## Run it locally
```
python3 -m http.server 8791      # open http://localhost:8791 (edits stay in the browser)
```

## Deploy
1. Import the repo into Vercel. The root directory is the repo root.
2. Add a Blob store to the project. That sets `BLOB_READ_WRITE_TOKEN`.
3. Add `EDIT_KEY` and `INGEST_KEY` as environment variables (see `.env.example`). Use two different long random strings.
4. Connect the form: follow the setup steps at the top of `google-form/form-to-tracker.gs`.

Deploying by hand: `npx vercel --prod --yes` (run `npx vercel link` once in a fresh clone).

## Update the submission PDF
```
pip install -r scripts/requirements.txt
python3 scripts/build_pdf.py --live       # pulls the saved board, writes GEO-Audit-Submission.pdf
npx vercel --prod --yes                   # redeploy so the download link serves it
```

## Keys
- `.edit-key` unlocks editing on the live site. `.ingest-key` lets the form add survey responses. Both are local files and Vercel environment variables, and neither is committed.
- Rotate a key: generate a new one, set it with `npx vercel env`, redeploy.
- Remove a bad form response: `curl -X DELETE "https://geo.tinkeryard.dev/api/survey?formResponseId=ID" -H "x-edit-key: $(cat .edit-key)"`.

## Privacy
The site is public. Log interviewees by role and company type, not by name. Form responses carry only answer letters, with no names or emails.
