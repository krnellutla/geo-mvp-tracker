# 21-Day Plan: GEO Audit MVP

**Sat 3 Oct → Fri 23 Oct 2026** · Day 1 = 3 Oct, Day 21 = 23 Oct

## What "MVP done" means

Pass or fail by Day 21, with arithmetic. This follows your north star: spec first, verifier first, and you can explain every line.

| # | Gate | Pass bar | Source |
|---|---|---|---|
| G1 | **Real user** | Observation rewritten from ≥3 real marketing-lead conversations (no synthetic Mei Ling) | Hypothesis note; Golden Pairs Pair 6 |
| G2 | **Labeller accuracy** | AI labeller matches golden labels ≥90% on a held-out set of ≥30 answers, and every label quotes its evidence | Golden Pairs Part B + grading rule |
| G3 | **Stability** | Citation Share drifts ≤ ±15 pts across 3 runs in one week, no content change | Falsifier 4 |
| G4 | **Known-answer test** | The audit reproduces a known result (e.g. the CEO-screenshot prompt: competitors A and B named, brand absent) | Grading rule 4 |
| G5 | **Shipped** | Gradio app takes inputs → writes the answer log and the one-page report. 2 audits delivered to real companies on it | Pair 1 deliverable |
| G6 | **Willingness to pay** | Count of companies committing to S$300/month, reported honestly out of N delivered | Hypothesis |

**Two things to fix before Day 1:**

1. **The 9 Oct deadline in your hypothesis and investor deck can't be met.** Five hand-run audits is 5 × 360 = 1,800 answers in 6 days, and you have no confirmed companies yet. Re-date it to **23 Oct** and change the pass bar to "2 delivered, 3 conversations, go/no-go on the rest". Do this on Day 1 and update the deck's "[__ of 5]" line.
2. **The observation is flagged as a synthetic composite.** Your own note says the assignment rejects an LLM-written observation. Day 1–5 exists to fix that. Don't skip it for build time.

**Scope.** Your north star puts the GEO audit at the **January** rung (retrieval and tools). This plan is the **Phase 1 + 2 slice** from your deck: a rule-based runner plus a golden-set-verified labeller. That stays inside what you can explain line by line. Dashboards, weekly tracking, agency multi-brand view and content generation are out.

---

## Week 1 (3–9 Oct): Reality contact, spec lock, golden set

*Goal: the spec is real and the label rule is settled before any code.*

| Day | Date | Do | Done when |
|---|---|---|---|
| 1 | Sat 3 Oct | Re-date the hypothesis (9 Oct → 23 Oct). Write the list of 15 marketing leads you can reach (ex-Visa, fintech, SEA). Send 10 outreach messages with the ask: "Walk me through the last time someone asked whether you show up in ChatGPT." | List of 15 named people, 10 sent |
| 2 | Sun 4 Oct | Pick the **first client** (B2B payments/fintech SG is your edge). Collect brand + aliases + 3 competitors + domains. Draft the entity list as a file. | `entities.json` for client #1 |
| 3 | Mon 5 Oct | Run conversations #1–2 (Mom Test, 30 min). Take notes in their words. Ask for the real question their CEO/investor asked. | 2 interview notes saved |
| 4 | Tue 6 Oct | Conversation #3. Rewrite `geo-observation-hypothesis.md` with the **real** person: their words, their numbers. | Observation replaced, no composite |
| 5 | Wed 7 Oct | Draft the **30 buyer prompts** with the client's language (no brand names in prompts). Include the "known answer" prompt for G4. | `prompts.csv`, 30 rows |
| 6 | Thu 8 Oct | Hand-run audit slice: 10 prompts × ChatGPT + Perplexity × 3 runs (60 answers). Logged out, incognito, Singapore. Log date and engine version on each row. | 60 raw answers in the sheet |
| 7 | Fri 9 Oct | **Label all 60 by hand** using the rule (Cited / Recommended / Mentioned / Absent, with quote). List every ruling you had to make up. Send the label rule to your mentor for sign-off. | 60 labelled rows, rulings list |

**Weekend (10–11 Oct, light):** label 30 more answers. This is your held-out test set for G2, so do not tune on it. Run the stranger test from the Golden Pairs note: give the rule and 10 unlabelled answers to a non-marketer and log every question they ask.

## Week 2 (10–16 Oct): Build the loop (input → process → output)

*Goal: a local pipeline that reproduces your hand labels.*

| Day | Date | Build | Verifier |
|---|---|---|---|
| 8 | Sat 10 Oct | Golden set as code: `golden/` with 13 existing pairs (8 plans + 5 labels) plus your hand-labelled answers, in JSONL. Write `eval.py` first: it takes any labeller and prints % agreement and the mismatches. | `eval.py` runs against a dummy labeller and scores it |
| 9 | Sun 11 Oct | **Runner** (rules only): read `prompts.csv`, call the engine APIs (ChatGPT, Perplexity, Gemini), save raw answer + sources + timestamp + model id to SQLite or CSV. Same input, same output shape. | 10 prompts × 3 engines logged with no manual steps |
| 10 | Mon 12 Oct | **Deterministic labeller**: the parts that need no LLM. Cited = own domain/subdomain in sources. Alias match. Empty answer excluded from the denominator. | Matches your hand labels on all Cited/alias/empty cases |
| 11 | Tue 13 Oct | **LLM labeller** for Recommended vs Mentioned (and negative flag). Prompt returns label + quoted evidence as JSON. Reject any label with no quote. | First G2 score on the dev set (expect messy) |
| 12 | Wed 14 Oct | Iterate the prompt against the **dev** set only. Add each disputed label as a new golden pair (L6, L7…). Don't touch the held-out 30. | Dev agreement ≥85% |
| 13 | Thu 15 Oct | **Citation Share calculator** per engine and per competitor, with the arithmetic: (Cited or Recommended) ÷ answers returned. Run it on your hand-labelled 60 and confirm it equals your spreadsheet number. | Code number = hand number, exactly |
| 14 | Fri 16 Oct | **G2 test:** score the held-out 30. Pass ≥90% and quote-complete, or write down why not and what changes. | Held-out agreement recorded with the date |

**Honest risk to check on Day 9:** the API answer is not the same as the logged-out Singapore UI answer, and Google AI Overviews has no API. Run the same 5 prompts through the UI and the API and note the difference. If it is large, the audit uses 3 engines for v1, and AIO stays a manual add-on. Say that plainly in the report.

## Week 3 (17–23 Oct): Ship, test on real companies, decide

*Goal: the app is in front of real people and the numbers hold.*

| Day | Date | Do | Done when |
|---|---|---|---|
| 15 | Sat 17 Oct | **Gradio UI**: inputs (brand, aliases, competitors, prompts upload, market) → run → table of labelled answers (human can override any label) → Citation Share. | App runs locally end to end on client #1 |
| 16 | Sun 18 Oct | **Report page**: per-engine Citation Share vs 3 competitors, the 5 prompts where competitors win, a place for 5 fixes, and the audit date and engine versions as a footer. | One-page report exports as PDF or HTML |
| 17 | Mon 19 Oct | **Crawler check** (Pair 8, no LLM): read robots.txt, a table of crawler → allowed/blocked → the line responsible. Add the Google-Extended caveat to the output text. | Matches a site you know the answer for |
| 18 | Tue 20 Oct | **G4 and G3 runs:** run the full 30 × 3 engines × 3 runs on client #1. Check the known-answer prompt. Compute drift across the 3 runs. | G4 pass/fail and drift in points, written down |
| 19 | Wed 21 Oct | Write the 5 fixes by hand from what the cited competitor pages have that the client's don't. Deliver audit #1 on a 30-min call. Ask: "How did you report this last month?" and the S$300 question. | Call done, answer recorded verbatim |
| 20 | Thu 22 Oct | Audit #2 on a second company using the app (not hand-run). Re-run 5 prompts from audit #1 to confirm a week-later stability check. | 2 audits delivered |
| 21 | Fri 23 Oct | **Verdict day.** Fill the gate table with real numbers. Write the go/no-go. Update the deck's "[__ of 5]" line with the true count. **Recall test:** close the chatbot and rebuild the runner → labeller → share loop from memory in 60 minutes. | Dated verdict file |

---

## Decision rules for Day 21

- **G3 fails (drift > ±15 pts):** stop. The number is not sellable. Increase runs or tighten prompts and re-test. Do not build more.
- **G2 fails (<90%):** ship the human-labelled version only. The AI labeller is not trusted yet. This is a valid outcome.
- **G6: nobody commits to pay:** that is a result, not a failure of the build. Re-read falsifiers 1–3 (existing tool is enough, or the agency is the real buyer) and change the subject, not the code.
- **G1 not met (can't reach 3 real people by Day 5):** by your own Pair 4 kill signal, the idea stays parked. Do not start the build in Week 2.

## Cost and tooling notes

- 30 prompts × 3 engines × 3 runs = 270 API calls per audit. Check each provider's current pricing before Day 9 and set a spend cap.
- Keep engine model ids and dates on every row. Engines change on their own, and the audit only describes the week it was run.
- Nothing publishes automatically. A human confirms labels in the UI.
- Rejected-label rule from Part B: a "Cited" label with no quote, or on a third-party domain, is wrong. The eval treats a missing quote as a fail even when the label matches.

## What this plan deliberately leaves out

Weekly or daily tracking, a multi-brand view, sentiment scoring, content generation, languages beyond English, and agency buyers (log those as segment signals, not as counts toward the pass bar).
