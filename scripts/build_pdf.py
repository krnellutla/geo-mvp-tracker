#!/usr/bin/env python3
"""Build the submission PDF from data/tracker.json (same source as the web app).

Usage:  python3 scripts/build_pdf.py          (needs: pip install reportlab)
        python3 scripts/build_pdf.py --live   (also merges edits saved on the live board)
Output: GEO-Audit-Submission.pdf at the repo root (the site serves it)
"""
import json, sys
from pathlib import Path
from datetime import date
from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.units import mm
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.pdfgen import canvas as rl_canvas
from reportlab.platypus import (BaseDocTemplate, PageTemplate, Frame, Paragraph, Spacer, Table, TableStyle,
                                PageBreak, KeepTogether, HRFlowable, CondPageBreak)
from reportlab.platypus.tableofcontents import TableOfContents

ROOT = Path(__file__).resolve().parent.parent  # repo root
D = json.loads((ROOT / "data" / "tracker.json").read_text())
M = D["meta"]


# ---------------------------------------------------------------- live merge
def merge_live():
    """Overlay the board state saved at <tracker_url>/api/state onto the base data."""
    import urllib.request
    try:
        with urllib.request.urlopen(M["tracker_url"].rstrip("/") + "/api/state", timeout=15) as r:
            o = json.load(r)
    except Exception as e:
        sys.exit(f"could not read live state: {e}")
    norm = {"doing": "partial", "partial": "partial", "done": "done", "blocked": "blocked", "todo": "todo"}
    for p in D["plan"]:
        x = (o.get("plan") or {}).get(str(p["day"]))
        if x:
            p["status"] = norm.get(x.get("status"), p["status"])
            p["evidence"] = x.get("evidence", p["evidence"])
            p["note"] = x.get("note", "")
    for g in D["gates"]:
        g.update((o.get("gates") or {}).get(g["id"], {}))
    for d in D["deliverables"]:
        d.update((o.get("deliverables") or {}).get(d["name"], {}))
    D["observation"].update(o.get("observation") or {})
    D["verdict"].update(o.get("verdict") or {})
    V = D["validation"]
    V["survey"]["responses"] = (o.get("survey") or []) + (o.get("formResponses") or [])
    V["interviews"] = o.get("interviews") or []
    V["audits"] = o.get("audits") or []
    M["saved"] = (o.get("updatedAt") or "")[:10]


if "--live" in sys.argv:
    merge_live()
M["updated"] = date.today().isoformat()  # "data as of" is the build date

# ---------------------------------------------------------------- fonts / colours
FD = Path("/System/Library/Fonts/Supplemental")
try:
    pdfmetrics.registerFont(TTFont("B", str(FD / "Arial.ttf")))
    pdfmetrics.registerFont(TTFont("B-Bold", str(FD / "Arial Bold.ttf")))
    pdfmetrics.registerFont(TTFont("B-Italic", str(FD / "Arial Italic.ttf")))
    pdfmetrics.registerFontFamily("B", normal="B", bold="B-Bold", italic="B-Italic", boldItalic="B-Bold")
    FONT, BOLD = "B", "B-Bold"
except Exception:
    FONT, BOLD = "Helvetica", "Helvetica-Bold"

HEX = colors.HexColor
INK, MUTED, LINE, SOFT = HEX("#0f1a26"), HEX("#4a5866"), HEX("#d5dbe3"), HEX("#f3f5f8")
VIOLET, VIOLET_SOFT = HEX("#5a3fd0"), HEX("#ece8fb")
OK, OK_SOFT = HEX("#0b7a5a"), HEX("#dff3ec")
AMBER, AMBER_SOFT = HEX("#92400E"), HEX("#fbefd6")
RED, RED_SOFT = HEX("#b3372a"), HEX("#f8e1de")
W, H = A4
LM = RM = 18 * mm

SWAP = {"→": "->", "≥": ">=", "≤": "<=", "±": "+/-"}


def t(s):
    s = str(s)
    for a, b in SWAP.items():
        s = s.replace(a, b)
    return s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")


def fdate(iso, short=False):
    d = date.fromisoformat(str(iso)[:10])
    return d.strftime("%-d %b" if short else "%-d %B %Y")


# ---------------------------------------------------------------- styles
def S(name, **kw):
    base = dict(fontName=FONT, fontSize=9.4, leading=13.6, textColor=INK, spaceAfter=4)
    base.update(kw)
    return ParagraphStyle(name, **base)


P = S("p")
SM = S("sm", fontSize=8.6, leading=12, textColor=MUTED)
H1 = S("h1", fontName=BOLD, fontSize=17, leading=21, spaceBefore=0, spaceAfter=3, keepWithNext=1)
H2L = S("h2l", fontName=BOLD, fontSize=10.8, leading=14, spaceBefore=13, spaceAfter=4, textColor=INK)
H2 = S("h2", fontName=BOLD, fontSize=10.8, leading=14, spaceBefore=13, spaceAfter=4, textColor=INK, keepWithNext=1)
EYEBROW = S("eyebrow", fontName=BOLD, fontSize=7.6, leading=10, textColor=VIOLET, spaceAfter=2, keepWithNext=1)
CELL = S("cell", fontSize=8.3, leading=11, spaceAfter=0)
CELLB = S("cellb", parent=CELL, fontName=BOLD) if False else S("cellb", fontName=BOLD, fontSize=8.3, leading=11, spaceAfter=0)
TH = S("th", fontName=BOLD, fontSize=7.2, leading=9.5, textColor=MUTED, spaceAfter=0)
BUL = S("bul", leftIndent=12, bulletIndent=1, spaceAfter=2.5)
QUOTE = S("quote", leftIndent=0, fontSize=9.6, leading=14.2, textColor=INK, fontName="B-Italic" if FONT == "B" else "Helvetica-Oblique")
TOC1 = S("toc1", fontSize=10, leading=17, spaceAfter=0)


def para(s, st=P):
    return Paragraph(t(s), st)


def bullets(items, numbered=False):
    return [Paragraph(t(x), BUL, bulletText=(f"{i}." if numbered else "•")) for i, x in enumerate(items, 1)]


# ---------------------------------------------------------------- flowable helpers
def tbl(head, rows, widths, empty="Nothing logged yet.", zebra=True):
    """Clean table: small-caps header, hairlines, optional zebra, colored cells accepted as flowables."""
    def cell(c, style):
        return c if hasattr(c, "wrap") else Paragraph(t(c).replace("\n", "<br/>"), style)
    data = []
    if any(head):
        data.append([Paragraph(t(h).upper(), TH) for h in head])
    if rows:
        data += [[cell(c, CELL) for c in r] for r in rows]
    else:
        data.append([Paragraph(t(empty), SM)] + [""] * (len(head) - 1))
    x = Table(data, colWidths=[w * mm for w in widths], repeatRows=1 if any(head) else 0)
    st = [("VALIGN", (0, 0), (-1, -1), "TOP"), ("TOPPADDING", (0, 0), (-1, -1), 4.5), ("BOTTOMPADDING", (0, 0), (-1, -1), 4.5),
          ("LEFTPADDING", (0, 0), (-1, -1), 6), ("RIGHTPADDING", (0, 0), (-1, -1), 6),
          ("LINEBELOW", (0, 0), (-1, -1), 0.4, LINE)]
    if any(head):
        st += [("BACKGROUND", (0, 0), (-1, 0), SOFT), ("LINEBELOW", (0, 0), (-1, 0), 0.9, INK)]
    if zebra and rows:
        for i in range(2 if any(head) else 1, len(data), 2):
            st.append(("BACKGROUND", (0, i), (-1, i), HEX("#fafbfc")))
    if not rows:
        st.append(("SPAN", (0, 1 if any(head) else 0), (-1, 1 if any(head) else 0)))
    x.setStyle(TableStyle(st))
    return x


def kv(rows, widths=(38, 134)):
    """Two-column key/value table, no header."""
    data = [[Paragraph(t(k).upper(), TH), v if hasattr(v, "wrap") else Paragraph(t(v).replace("\n", "<br/>"), CELL)] for k, v in rows]
    x = Table(data, colWidths=[w * mm for w in widths])
    x.setStyle(TableStyle([("VALIGN", (0, 0), (-1, -1), "TOP"), ("TOPPADDING", (0, 0), (-1, -1), 5), ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
                           ("LEFTPADDING", (0, 0), (-1, -1), 6), ("LINEBELOW", (0, 0), (-1, -1), 0.4, LINE), ("LINEABOVE", (0, 0), (-1, 0), 0.9, INK)]))
    return x


def callout(text, kind="info", title=None):
    bg, bar, fg = {"info": (VIOLET_SOFT, VIOLET, INK), "warn": (AMBER_SOFT, AMBER, INK), "ok": (OK_SOFT, OK, INK), "bad": (RED_SOFT, RED, INK)}[kind]
    inner = []
    if title:
        inner.append(Paragraph(t(title).upper(), S("ct", fontName=BOLD, fontSize=7.4, leading=10, textColor=bar, spaceAfter=2)))
    inner.append(Paragraph(t(text), S("cb", fontSize=9.2, leading=13.2, textColor=fg, spaceAfter=0)))
    x = Table([[inner]], colWidths=[W - LM - RM])
    x.setStyle(TableStyle([("BACKGROUND", (0, 0), (-1, -1), bg), ("LINEBEFORE", (0, 0), (0, -1), 3, bar),
                           ("LEFTPADDING", (0, 0), (-1, -1), 10), ("RIGHTPADDING", (0, 0), (-1, -1), 10),
                           ("TOPPADDING", (0, 0), (-1, -1), 7), ("BOTTOMPADDING", (0, 0), (-1, -1), 8)]))
    return x


STATUS = {"done": ("Done", OK), "partial": ("In progress", AMBER), "doing": ("In progress", AMBER), "todo": ("To do", MUTED),
          "blocked": ("Blocked", RED), "progress": ("In progress", AMBER), "draft": ("Draft", RED), "pending": ("Pending", RED),
          "provisional": ("Provisional", AMBER), "open": ("Open", MUTED), "pass": ("Pass", OK), "fail": ("Fail", RED)}


def status_p(key, extra=None):
    label, col = STATUS.get(key, (key, MUTED))
    s = f'<font color="{col.hexval().replace("0x", "#")}"><b>{t(label)}</b></font>'
    if extra:
        s += f'<br/><font color="#b3372a" size="7.8"><b>{t(extra)}</b></font>'
    return Paragraph(s, CELL)


class Section(Paragraph):
    """Numbered section heading (used for the contents list)."""


def section(num, title, eyebrow=None):
    out = [CondPageBreak(60 * mm)]
    if eyebrow:
        out.append(Paragraph(t(eyebrow).upper(), EYEBROW))
    h = Section(f'<font color="#5a3fd0">{num}</font>&nbsp;&nbsp;{t(title)}' if num else t(title), H1)
    h._toc = f"{num}  {title}" if num else title
    out += [h, HRFlowable(width="100%", thickness=1.1, color=INK, spaceBefore=1, spaceAfter=8)]
    return out


# ---------------------------------------------------------------- derived numbers
upd = date.fromisoformat(M["updated"][:10])
start = date.fromisoformat(M["start"])
day_n = max(1, min(21, (upd - start).days + 1))
plan = D["plan"]
n_done = sum(1 for p in plan if p["status"] == "done")
n_prog = sum(1 for p in plan if p["status"] in ("partial", "doing"))
n_behind = sum(1 for p in plan if date.fromisoformat(p["date"]) < upd and p["status"] != "done")
V = D["validation"]
n_resp, n_int, n_aud = len(V["survey"]["responses"]), len(V["interviews"]), len(V["audits"])
_rs = V["survey"]["responses"]
_seg = lambda r: r.get("q1") in ("A", "B") and r.get("q2") == "A"
n_seg = sum(1 for r in _rs if _seg(r))
n_strong = sum(1 for r in _rs if _seg(r) and r.get("q4") in ("A", "B") and r.get("q10") == "B")
dist_rows = []
for q in V["survey"]["questions"]:
    opts = [o.split(". ", 1)[1] if ". " in o else o for o in q["options"].split(" \u00b7 ")]
    lines = []
    for k, o in enumerate(opts):
        c = sum(1 for r in _rs if r.get("q%d" % q["n"]) == chr(65 + k))
        if c:
            lines.append(f"{o}: {c}")
    blank = sum(1 for r in _rs if not r.get("q%d" % q["n"]))
    if _rs and blank:
        lines.append(f"No answer recorded: {blank}")
    dist_rows.append([q["n"], q["q"], "\n".join(lines) if lines else "No responses yet."])
URL = M.get("tracker_url", "")

# ---------------------------------------------------------------- canvas: header, footer, cover
class NumberedCanvas(rl_canvas.Canvas):
    def __init__(self, *a, **k):
        super().__init__(*a, **k)
        self._saved = []

    def showPage(self):
        self._saved.append(dict(self.__dict__))
        self._startPage()

    def save(self):
        total = len(self._saved)
        for st in self._saved:
            self.__dict__.update(st)
            self._chrome(total)
            super().showPage()
        super().save()

    def _chrome(self, total):
        n = self._pageNumber
        if n == 1:
            return
        self.saveState()
        self.setFont(FONT, 7.6)
        self.setFillColor(MUTED)
        self.drawString(LM, H - 11 * mm, f"{M['title']}  |  Manual MVP submission")
        self.drawRightString(W - RM, H - 11 * mm, M["author"])
        self.setStrokeColor(LINE)
        self.setLineWidth(0.5)
        self.line(LM, H - 13 * mm, W - RM, H - 13 * mm)
        self.line(LM, 14 * mm, W - RM, 14 * mm)
        self.drawString(LM, 10 * mm, f"Data as of {fdate(M['updated'])}")
        if URL:
            self.setFillColor(VIOLET)
            self.drawCentredString(W / 2, 10 * mm, URL.replace("https://", ""))
        self.setFillColor(MUTED)
        self.drawRightString(W - RM, 10 * mm, f"Page {n} of {total}")
        self.restoreState()


def cover(c, doc):
    c.saveState()
    band = 98 * mm
    c.setFillColor(INK)
    c.rect(0, H - band, W, band, stroke=0, fill=1)
    c.setFillColor(VIOLET)
    c.rect(0, H - band, W, 2.2 * mm, stroke=0, fill=1)
    # signature: the four audit labels as chips
    x = LM
    for lab, col in (("Cited", OK), ("Recommended", VIOLET), ("Mentioned", AMBER), ("Absent", MUTED)):
        c.setFont(BOLD, 7.4)
        w = c.stringWidth(lab.upper(), BOLD, 7.4) + 10
        c.setFillColor(col)
        c.roundRect(x, H - 24 * mm, w, 5.4 * mm, 2.4, stroke=0, fill=1)
        c.setFillColor(colors.white)
        c.drawString(x + 5, H - 22.4 * mm, lab.upper())
        x += w + 5
    c.setFillColor(HEX("#9fb0c1"))
    c.setFont(FONT, 7)
    c.drawString(LM, H - 28.6 * mm, "The four labels every AI answer receives for each brand")
    c.setFont(BOLD, 8)
    c.drawString(LM, H - 38 * mm, "100X ENGINEERING  |  MANUAL MVP SUBMISSION")
    c.setFillColor(colors.white)
    c.setFont(BOLD, 31)
    c.drawString(LM, H - 54 * mm, M["title"])
    c.setFont(FONT, 11)
    c.setFillColor(HEX("#d3dce6"))
    from reportlab.lib.utils import simpleSplit
    y = H - 63 * mm
    for ln in simpleSplit(M["subtitle"], FONT, 11, W - LM - RM - 20 * mm)[:4]:
        c.drawString(LM, y, ln)
        y -= 5.4 * mm
    c.setFont(FONT, 9)
    c.setFillColor(HEX("#c4d0dc"))
    c.drawString(LM, H - band + 9 * mm, f"{M['author']}   |   {fdate(M['start'])} to {fdate(M['end'])}   |   Data as of {fdate(M['updated'])}")
    c.restoreState()


# ---------------------------------------------------------------- build the story
story = []
story.append(Spacer(1, 90 * mm))

# snapshot
def stat(big, small):
    return [Paragraph(f'<font size="21" color="#0f1a26"><b>{t(big)}</b></font>', S("sb", leading=24, spaceAfter=0)),
            Paragraph(t(small), S("ss", fontSize=7.8, leading=10, textColor=MUTED, spaceAfter=0))]


snap = Table([[stat(f"Day {day_n}", "of 21"), stat(f"{n_done}", f"cards done ({n_prog} in progress)"), stat(f"{n_behind}", "days behind plan"),
               stat(f"{n_resp} / {n_int} / {n_aud}", "survey / interviews / audits")]],
             colWidths=[(W - LM - RM) / 4] * 4)
snap.setStyle(TableStyle([("LINEABOVE", (0, 0), (-1, 0), 0.9, INK), ("LINEBELOW", (0, 0), (-1, 0), 0.4, LINE), ("TOPPADDING", (0, 0), (-1, -1), 8),
                          ("BOTTOMPADDING", (0, 0), (-1, -1), 8), ("VALIGN", (0, 0), (-1, -1), "TOP"), ("LEFTPADDING", (0, 0), (-1, -1), 2)]))
story += [Paragraph("SNAPSHOT", EYEBROW), snap, Spacer(1, 8)]

vd = D["verdict"]
story += [callout(f"{vd['current']} {vd['reason']}", "warn", "Current verdict"), Spacer(1, 8)]
story += [callout(M["evidence_boundary"], "info", "Evidence boundary"), Spacer(1, 10)]
story += [Paragraph("CONTENTS", EYEBROW)]
toc = TableOfContents()
toc.levelStyles = [S("tocl", fontSize=9.6, leading=15.5, spaceAfter=0)]
toc.dotsMinLevel = 0
story += [toc, PageBreak()]

# --- deliverables at a glance
story += section("", "Submission at a glance", "Deliverables")
story += [para("Eight deliverables, with the honest status of each as of " + fdate(M["updated"]) + ".", P),
          tbl(["Deliverable", "Status", "Where it stands"], [[x["name"], status_p(x["status"]), x["note"]] for x in D["deliverables"]], [42, 22, 108]),
          Spacer(1, 8)]
if URL:
    story += [kv([("Published tracker", URL), ("North star", D["north_star"])])]
    story[-1].hAlign = "LEFT"
story += [CondPageBreak(95 * mm)]

# --- 1 observation
o = D["observation"]
story += [Spacer(1, 16)] + section("1", "Observation", "Deliverable")
story += [callout(o["status"], "warn", "Status"), Spacer(1, 6),
          Paragraph(t(o["text"]), QUOTE), Spacer(1, 4),
          kv([("What breaks", o["breaks"]), ("Cost today", o["cost"])]),
          para("Who this is about", H2), kv([("Subject", D["user"]["who"]), ("Context", D["user"]["context"]), ("Not the user (yet)", D["user"]["not_user"])])]

# --- 2 hypothesis
h = D["hypothesis"]
story += [Spacer(1, 16)] + section("2", "Hypothesis", "Deliverable")
story += [para(h["statement"]), kv([("Original pass bar", h["pass_bar_original"]), ("Current pass bar", h["pass_bar_current"])]),
          para("What would prove us wrong", H2), *bullets(h["falsifiers"], True),
          para("Commitment, defined", H2), para(h["commitment_definition"]),
          para("Pass-bar change log", H2), *bullets(h["pass_bar_log"]), CondPageBreak(95 * mm)]

# --- 3 discovery
dc = D["discovery"]
story += section("3", "Discovery document", "Deliverable")
story += [para(dc["method"]), para("Evidence base at a glance", H2),
          tbl(["Source", "Real or not", "Used for"], [[x["source"], x["real"], x["used"]] for x in dc["evidence_matrix"]], [56, 52, 64]),
          CondPageBreak(45 * mm), para("Evidence register", H2L), para("Every number used, where it came from, and how far to trust it.", SM),
          tbl(["Claim", "Source", "Type", "How it is used"], [[x["claim"], x["source"], x["type"], x["use"]] for x in dc["evidence_register"]], [44, 58, 28, 42]),
          para("Market scan", H2),
          tbl(["Player", "Signal", "Built for"], [[x["player"], x["signal"], x["built_for"]] for x in dc["market"]], [38, 86, 48]),
          Spacer(1, 4), para(dc["market_read"]),
          para("Research gaps and where they fit the MVP", H2),
          tbl(["Gap", "What it is", "Fit with the MVP"], [[x["gap"], x["what"], x["fit"]] for x in dc["research_gaps"]], [26, 70, 76]),
          Spacer(1, 3), para(dc["caution"], SM),
          para("Business model", H2), tbl(["Stage", "What"], [[x["stage"], x["what"]] for x in dc["business_model"]], [42, 130]),
          para("Roadmap: automate only what is done by hand", H2), tbl(["Phase", "What"], [[x["phase"], x["what"]] for x in dc["roadmap"]], [30, 142]),
          para("Pilot offer", H2),
          tbl(["The client gives", "The client gets"], [["\n".join("• " + x for x in dc["pilot_offer"]["you_give"]), "\n".join("• " + x for x in dc["pilot_offer"]["you_get"])]], [86, 86], zebra=False),
          para("What we will not claim", H2), *bullets(dc["wont_claim"]), CondPageBreak(95 * mm)]

# --- 4 MVP plan
story += section("4", "21-day manual MVP plan", "Deliverable")
story += [para("Manual-first: every audit is hand-run and hand-labelled. Software is only a labelling aid, and it ships only if it matches hand labels on a held-out set at 90% or better."),
          callout(D["manual_note"], "info", "Why this is a manual MVP"), Spacer(1, 2),
          para("Success gates", H2),
          tbl(["Gate", "Pass bar", "Current"], [[f"{g['id']}  {g['name']}", g["bar"], g["current"]] for g in D["gates"]], [34, 70, 68]),
          CondPageBreak(45 * mm), para("Day by day", H2L)]
rows = []
for p in plan:
    late = date.fromisoformat(p["date"]) < upd and p["status"] != "done"
    key = p["status"] if not (late and p["status"] == "todo") else "todo"
    label = status_p(key, ("Behind plan" if late and key == "todo" else None))
    ev = p.get("evidence", "")
    note = p.get("note", "")
    detail = t(p["title"]) + f'<br/><font color="#4a5866" size="7.8">Planned output: {t(p["output"])}</font>'
    if ev or note:
        detail += f'<br/><font color="#096a4e" size="7.8">Evidence: {t(ev or "none recorded")}</font>' if ev else ""
        detail += f'<br/><font color="#4a5866" size="7.8">Note: {t(note)}</font>' if note else ""
    rows.append([f"{p['day']}", fdate(p["date"], True), Paragraph(detail, CELL), label])
story += [tbl(["Day", "Date", "Activity", "Status"], rows, [10, 17, 111, 34]), CondPageBreak(95 * mm)]

# --- 5 tracker
story += section("5", "Published tracker link", "Deliverable")
story += [Paragraph(f'<link href="{URL}" color="#5a3fd0"><b>{t(URL)}</b></link>' if URL else t("Pending deployment."), S("url", fontSize=12.5, leading=17, spaceAfter=6)),
          para("The tracker is the execution layer, not proof of validation. It shows the 21-day plan as a kanban board, the validation log, the evidence register and the verdict. "
               "Edits are made on the site behind an edit key, and this PDF is rebuilt from the saved board, so the two cannot drift apart."),
          *bullets(["Board: each day is a card. A card can move to Done only when it carries evidence.", "Validation tab: survey responses, interviews and audits are logged by role and company type, not by name.",
                    "Method tab: the input, process and output card and the golden set."])]

# --- 6 validation log
story += [Spacer(1, 16)] + section("6", "Validation log", "Deliverable")
story += [para(V["survey"]["purpose"]), para("Strong lead: " + V["survey"]["strong_lead_rule"], SM),
          kv([("Survey responses", n_resp), ("In the target segment", f"{n_seg} of {n_resp} (Q1 A or B and Q2 A)"), ("Strong leads", n_strong), ("Real conversations", f"{n_int} of 3 target"), ("Audits delivered", n_aud), ("Survey form", Paragraph(f'<link href="{M["survey_link"]}" color="#5a3fd0">Open the survey form</link>', CELL))], (38, 134)),
          CondPageBreak(60 * mm), para("What the responses say so far", H2),
          para("Counts per answer. This is a small group of friends and contacts, so it is a screener, not evidence of demand.", SM),
          tbl(["#", "Question", "Answers"], dist_rows, [8, 70, 94], "No responses yet."),
          para("Known gaps in the survey", H2), *bullets(V["survey"].get("known_gaps", [])),
          CondPageBreak(45 * mm), para("Survey questions", H2L),
          tbl(["#", "Question", "Options", "What it tests"], [[q["n"], q["q"], q["options"], q["tests"]] for q in V["survey"]["questions"]], [8, 52, 74, 38]),
          Spacer(1, 3), para(V["survey"]["reading_rule"], SM), para(V["survey"]["tally_note"], SM),
          para("Survey responses", H2),
          tbl(["Respondent"] + [f"Q{i}" for i in range(1, 11)], [[r["id"]] + [r.get(f"q{i}", "") for i in range(1, 11)] for r in V["survey"]["responses"]], [24] + [14.8] * 10, "No responses logged yet."),
          para("Interview script", H2), *bullets(V["interview_script"], True),
          para("Interviews", H2),
          tbl(["Date", "Person", "Trigger in their words", "Did", "Reported", "S$300?", "Notes"],
              [[i["date"], i["person"], i["trigger"], i["did"], i["reported"], i["rerun"], i.get("notes", "")] for i in V["interviews"]], [23, 27, 30, 19, 20, 14, 39], "No interviews logged yet."),
          para("Audits delivered", H2),
          tbl(["Date", "Company type", "Citation Share", "Used in a report?", "Committed to S$300?"],
              [[a["date"], a["company"], a["share"], a["used"], a["committed"]] for a in V["audits"]], [20, 50, 30, 36, 36], "No audits delivered yet."),
          para("Limitations", H2), *bullets(V["limitations"])]

# --- golden set
gs = D["golden_set"]
story += [CondPageBreak(95 * mm)] + section("", "Golden set and grading", "Supporting method")
story += [para(gs["summary"]),
          tbl(["Label rule", "Plan grading rule (passes if it does all five)"],
              [["\n".join("• " + x for x in gs["label_rule"]), "\n".join(f"{i}. " + x for i, x in enumerate(gs["grading_rule"], 1))]], [86, 86], zebra=False),
          Spacer(1, 4), para("Target: " + gs["target"]), *bullets(gs["open_items"])]

# --- 7 IPO
ip = D["ipo"]
story += [Spacer(1, 16)] + section("7", "Input, process, output card", "Deliverable")
col = lambda items, num=False: [Paragraph((f"{i}.&nbsp;" if num else "•&nbsp;") + t(x), S("ic", fontSize=8.3, leading=11.2, spaceAfter=3.5, leftIndent=0)) for i, x in enumerate(items, 1)]
card = Table([[Paragraph("INPUT", TH), Paragraph("PROCESS", TH), Paragraph("OUTPUT", TH)], [col(ip["input"]), col(ip["process"], True), col(ip["output"])]],
             colWidths=[52 * mm, 68 * mm, 52 * mm])
card.setStyle(TableStyle([("BACKGROUND", (0, 0), (-1, 0), SOFT), ("LINEBELOW", (0, 0), (-1, 0), 0.9, INK), ("VALIGN", (0, 0), (-1, -1), "TOP"),
                          ("LINEAFTER", (0, 0), (1, -1), 0.4, LINE), ("LINEBELOW", (0, 1), (-1, -1), 0.4, LINE), ("TOPPADDING", (0, 0), (-1, -1), 6),
                          ("BOTTOMPADDING", (0, 0), (-1, -1), 6), ("LEFTPADDING", (0, 0), (-1, -1), 7)]))
story += [card, Spacer(1, 5), para(ip["note"], SM), CondPageBreak(95 * mm)]

# --- 8 verdict
story += section("8", "Verdict", "Deliverable")
story += [callout(vd["reason"], "warn", vd["current"]), Spacer(1, 4), para("As of " + fdate(vd["as_of"]), SM),
          para("Decision rules", H2), tbl(["Call", "When"], [[Paragraph(f"<b>{t(r['call'])}</b>", CELL), r["when"]] for r in vd["rules"]], [24, 148]),
          para("By dimension", H2), tbl(["Dimension", "Verdict"], [[x["dimension"], x["verdict"]] for x in vd["dimensions"]], [48, 124]),
          para("Next action", H2), para(vd["next"]),
          para("Submission summary", H2), *bullets(vd["summary"])]


# ---------------------------------------------------------------- document
class Doc(BaseDocTemplate):
    def afterFlowable(self, fl):
        if isinstance(fl, Section) and hasattr(fl, "_toc"):
            self.notify("TOCEntry", (0, fl._toc, self.page))


out = ROOT / "GEO-Audit-Submission.pdf"
doc = Doc(str(out), pagesize=A4, leftMargin=LM, rightMargin=RM, topMargin=20 * mm, bottomMargin=19 * mm,
          title=f"{M['title']} - Manual MVP submission", author=M["author"], subject="100X Engineering assignment submission")
frame = Frame(LM, 19 * mm, W - LM - RM, H - 39 * mm, id="f", leftPadding=0, rightPadding=0, topPadding=0, bottomPadding=0)
doc.addPageTemplates([PageTemplate(id="all", frames=[frame], onPage=lambda c, d: cover(c, d) if d.page == 1 else None)])
doc.multiBuild(story, canvasmaker=NumberedCanvas)
print("wrote", out)
