#!/usr/bin/env python3
"""
Add click-to-sort column headers to the BTB HTML export.

Pages patched: freeagents.htm, potentialfreeagents.htm, draft.htm, rosters/*.htm
Sortable columns: every header from "Pos" to the right (Pos, Age, Ht, Wt,
Ins ... Sta, plus Exp/College etc. on team rosters). Click once to sort,
click again to reverse. Row shading (row1/row2) is re-applied after each sort
so the page looks exactly as before. No CSS or markup is changed; a small
<script> is appended before </body>.

Usage:
    python SWBA_Index.py PATH [--offseason]
PATH can be the export's "html" folder, a folder containing it, or the .zip
(a zip is patched in place). Safe to run repeatedly - already-patched pages
are skipped.
"""

# ===========================================================================
#  LEAGUE SETTINGS - edit these, save, then run the batch file again
# ===========================================================================

# --- Offseason FA ---
SPENDING_LIMIT = 100000000        # soft cap; under it a team can bid (cap - salary) on non-Bird players,
                                  # at or over it non-Bird bids are mins only. None = use the game's cap.
MAX_STARTING_SALARY = 25000000    # most a bid's first-year salary can be
FA_BID_LIMITS = {1: 3, 2: 5, 3: 10}   # bids allowed in FA 1 / FA 2 / FA 3 (previous players don't count)
MIN_OFFER_ROUNDS = [2, 3]         # FA rounds where min offers are allowed (none in FA 1)
MAX_YEARS_NON_BIRD = 4
MAX_YEARS_BIRD = 5
MAX_RAISE_NON_BIRD = 5            # max raise or cut, in %
MAX_RAISE_BIRD = 10
RAISE_STEP = 0.5                  # % steps in the Raise dropdown
# Previous players = the team a player last played games for. When a franchise moves,
# map its old abbreviation to the new one so its old players still count, e.g. {"SEA": "OKC"}
TEAM_ABBREVIATION_ALIASES = {}

# --- Commish Corner ---
COMMISH_MAX_PLAYERS = 15          # flag teams with MORE players than this
COMMISH_MIN_PLAYERS = 10          # flag teams with FEWER players than this
COMMISH_SALARY_FLAG = 140000000   # flag teams with total salary OVER this

# ===========================================================================

import os
import sys
import zipfile
import shutil
import tempfile

MARKER = "<!-- sortable-columns -->"

SCRIPT = MARKER + r"""
<script>
window.sortInit = function () {
  function txt(td) { return (td.textContent || '').replace(/ /g, ' ').trim(); }
  function key(td) {
    var t = txt(td);
    var m = t.match(/^(\d+)-(\d+)$/);            // height like 6-8
    if (m) return +m[1] * 12 + +m[2];
    var n = t.replace(/[$,%]/g, '');
    if (n !== '' && !isNaN(n)) return parseFloat(n);
    return t.toLowerCase();
  }
  function cells(tr) {
    var out = [];
    for (var i = 0; i < tr.children.length; i++)
      if (tr.children[i].tagName === 'TD' || tr.children[i].tagName === 'TH') out.push(tr.children[i]);
    return out;
  }
  function isData(tr) { return /\brow[12]\b/.test(tr.className); }

  var rows = document.getElementsByTagName('tr');
  for (var r = 0; r < rows.length; r++) {
    var hr = rows[r], hc = cells(hr), posIdx = -1;
    for (var i = 0; i < hc.length; i++) {
      if (/\bheader\b/.test(hc[i].className) && txt(hc[i]) === 'Pos') { posIdx = i; break; }
    }
    if (posIdx < 0) continue;
    (function (hr, hc, posIdx) {
      for (var c = 0; c < hc.length; c++) {
        var byLast = hc[c].getAttribute && hc[c].getAttribute('data-lastname');
        if (txt(hc[c]) === '' || (c < posIdx && !byLast)) continue;
        (function (c, byLast) {
          var dir = 0;
          function k(td) {
            if (!byLast) return key(td);
            var p = txt(td).replace(/\s+(Jr\.?|Sr\.?|II|III|IV|V)$/i, '').split(/\s+/);
            return (p[p.length - 1] + ' ' + p.slice(0, -1).join(' ')).toLowerCase();
          }
          hc[c].style.cursor = 'pointer';
          hc[c].title = 'Click to sort';
          hc[c].onclick = function () {
            var data = [], n = hr.nextElementSibling;
            while (n && isData(n)) { data.push(n); n = n.nextElementSibling; }
            if (!data.length) return;
            var first = data[0].children[c];
            if (first && first.getElementsByTagName('table').length) return; // colour-box columns
            var numeric = typeof k(first) === 'number';
            dir = dir === 0 ? (numeric ? -1 : 1) : -dir;   // numbers: high first; text: A-Z
            var idx = data.map(function (tr, k) { return [tr, k]; });
            idx.sort(function (a, b) {
              var x = k(cells(a[0])[c] || a[0]), y = k(cells(b[0])[c] || b[0]);
              if (typeof x !== typeof y) { x = String(x); y = String(y); }
              return x < y ? -dir : x > y ? dir : a[1] - b[1];
            });
            var anchor = n, parent = hr.parentNode;
            idx.forEach(function (p, k) {
              p[0].className = p[0].className.replace(/\brow[12]\b/, k % 2 ? 'row2' : 'row1');
              parent.insertBefore(p[0], anchor);
            });
          };
        })(c, byLast);
      }
    })(hr, hc, posIdx);
  }
}; sortInit();
</script>
"""


def patch_file(path):
    with open(path, "r", encoding="latin-1") as f:
        html = f.read()
    if MARKER in html:
        return False
    low = html.lower()
    i = low.rfind("</body>")
    html = html[:i] + SCRIPT + html[i:] if i >= 0 else html + SCRIPT
    with open(path, "w", encoding="latin-1") as f:
        f.write(html)
    return True


# ---------------------------------------------------------------------------
# Extra pages: Depth Chart tool, Commish Corner, sidebar links
# ---------------------------------------------------------------------------
import re
import json
import html as htmlmod

ATTRS = ["Ins", "Jps", "Fts", "3ps", "Hnd", "Pas", "Orb", "Drb",
         "Psd", "Prd", "Stl", "Blk", "Qkn", "Jmp", "Str", "Sta"]


def read(path):
    with open(path, "r", encoding="latin-1") as f:
        return f.read()


def write(path, text):
    with open(path, "w", encoding="latin-1", newline="\n") as f:
        f.write(text)


def clean(cell):
    t = re.sub(r"<[^>]+>", "", cell)
    return htmlmod.unescape(t).replace("\xa0", " ").strip()


def section(html, title):
    """Return the HTML of the table that follows a tableheader titled `title`."""
    m = re.search(r"class=tableheader[^>]*>(?:&nbsp;)?\s*" + re.escape(title) + r"\s*</td>", html, re.I)
    if not m:
        return ""
    # colour boxes are tiny nested tables - turn them into a marker so </table> is unambiguous
    rest = re.sub(r"<table border=1[^>]*>\s*<td bgcolor=(#?\w+)[^>]*>\s*</td>\s*</tr>\s*</table>",
                  r"[[BOX:\1]]", html[m.end():], flags=re.I)
    end = rest.lower().find("</table>")
    return rest[:end] if end >= 0 else rest


def rows(segment):
    """Yield the list of raw <td> contents for each row1/row2 data row."""
    for m in re.finditer(r"<tr[^>]*class=row[12][^>]*>(.*?)</tr>", segment, re.S | re.I):
        yield re.findall(r"<td[^>]*>(.*?)</td>", m.group(1), re.S | re.I)


def box(cell):
    m = re.search(r"\[\[BOX:(#?\w+)\]\]", cell)
    return m.group(1) if m else ""


def pid(cell):
    m = re.search(r"player(\d+)\.htm", cell)
    return int(m.group(1)) if m else None


def parse_attr_table(html, team):
    out = []
    for c in rows(section(html, "Attributes")):
        if len(c) < 24 or pid(c[1]) is None:
            continue
        out.append({"id": pid(c[1]), "n": clean(c[1]), "t": team, "pos": clean(c[2]),
                    "age": clean(c[3]), "ht": clean(c[4]), "wt": clean(c[5]),
                    "cur": box(c[6]), "fut": box(c[7]),
                    "a": [clean(x) for x in c[8:24]]})
    return out


def teams_from_capreport(d):
    html = read(os.path.join(d, "capreport.htm"))
    teams = []
    def amt(cell):
        t = clean(cell)
        n = int(re.sub(r"[^\d]", "", t) or 0)
        return -n if "(" in t or t.startswith("-") else n
    for c in rows(html):
        m = re.search(r'href="?\./rosters/roster(\d+)\.htm"?>([^<]+)</a>', "".join(c))
        if not m:
            continue
        t = {"id": int(m.group(1)), "name": htmlmod.unescape(m.group(2)).strip()}
        if len(c) >= 4:
            t["sal"] = amt(c[2])
            t["cap"] = amt(c[2]) + amt(c[3])
        teams.append(t)
    teams.sort(key=lambda t: t["name"])
    return teams


def collect(d):
    teams = teams_from_capreport(d)
    players, info = [], []
    for t in teams:
        path = os.path.join(d, "rosters", "roster%d.htm" % t["id"])
        if not os.path.isfile(path):
            continue
        html = read(path)
        ps = parse_attr_table(html, t["id"])
        injured = {}
        for c in rows(section(html, "Unavailable Players")):
            if len(c) >= 3 and pid(c[0]) is not None:
                injured[pid(c[0])] = clean(c[1]) + " (" + clean(c[2]) + ")"
        for p in ps:
            if p["id"] in injured:
                p["inj"] = injured[p["id"]]
        players += ps
        roster_count = sum(1 for c in rows(section(html, "Roster")) if len(c) > 1 and pid(c[1]) is not None)
        salary = None
        m = re.search(r"Total Salary</td>\s*<td[^>]*>\s*\$?([\d,]+)", html)
        if m:
            salary = int(m.group(1).replace(",", ""))
        season = clean((re.findall(r"class=header[^>]*>\s*(\d{4})\s*</td>", section(html, "Contract")) or [""])[0])
        info.append({"team": t, "count": roster_count, "salary": salary, "season": season})
    fa_path = os.path.join(d, "freeagents.htm")
    if os.path.isfile(fa_path):
        players += parse_attr_table(read(fa_path), "FA")
    return teams, players, info


def page_head(d, title):
    """Re-use the exact <style> block and background from the export's own pages."""
    html = read(os.path.join(d, "freeagents.htm"))
    style = re.search(r"<style.*?</style>", html, re.S | re.I).group(0)
    bg = re.search(r"<body[^>]*>", html, re.I).group(0)
    return "<HTML>\n<title>%s</title>\n\n%s\n\n%s\n" % (title, style, bg)


def page_title(title):
    return ("<table width=800 border=0 cellspacing=0 cellpadding=0>\n"
            "   <tr><td class=newheader>%s</td></tr>\n   <tr><td><hr></td></tr>\n</table>\n" % title)


def page_foot(d):
    html = read(os.path.join(d, "freeagents.htm"))
    m = re.search(r"(<font size=2><a class=linkmain href=\"http://www.greydogsoftware.com\".*?)</body>", html, re.S | re.I)
    foot = m.group(1) if m else ""
    foot = re.sub(re.escape(MARKER) + r"\s*<script>.*?</script>\s*", "", foot, flags=re.S)  # don't copy the page's sort script
    return foot + "\n</body>\n</HTML>\n"


def build_commish(d, info):
    LIMIT = COMMISH_SALARY_FLAG
    def money(v):
        return "$" + format(v, ",") if v is not None else "n/a"
    def link(t):
        return '<a class=linkmain href=./rosters/roster%d.htm>%s</a>' % (t["id"], htmlmod.escape(t["name"]))

    def table(title, headers, body):
        h = "".join('       <td class=header width=%s%s>%s</td>\n' % (w, " align=left" if i == 0 else "", x)
                    for i, (x, w) in enumerate(headers))
        out = ("<table width=800 border= 0  cellspacing= 0  cellpadding= 0 >\n"
               "   <tr><td class=tableheader colspan=8>&nbsp;%s</td></tr>\n   <tr align=center>\n%s"
               "       <td class=header width=*>&nbsp;</td>\n   </tr>\n" % (title, h))
        if not body:
            body = [["&nbsp;None"] + ["&nbsp;"] * (len(headers) - 1)]
        for k, r in enumerate(body):
            out += "   <tr align=center class=row%d>\n" % (k % 2 + 1)
            for i, v in enumerate(r):
                out += "       <td class=main%s>%s</td>\n" % (" align=left" if i == 0 else "", v)
            out += "       <td class=main>&nbsp;</td>\n   </tr>\n"
        return out + "</table>\n<br>\n"

    season = next((i["season"] for i in info if i["season"]), "")
    over = [i for i in info if i["count"] > COMMISH_MAX_PLAYERS]
    under = [i for i in info if i["count"] < COMMISH_MIN_PLAYERS]
    rich = sorted([i for i in info if i["salary"] is not None and i["salary"] > LIMIT], key=lambda i: -i["salary"])
    red = lambda s: "<font color=#FF0000>%s</font>" % s
    body = page_head(d, "Commish Corner") + page_title("Commish Corner")
    body += table("Teams Over %d Players" % COMMISH_MAX_PLAYERS, [("&nbsp;Team", 250), ("Players", 100)],
                  [["&nbsp;" + link(i["team"]), red(i["count"])] for i in over])
    body += table("Teams Under %d Players" % COMMISH_MIN_PLAYERS, [("&nbsp;Team", 250), ("Players", 100)],
                  [["&nbsp;" + link(i["team"]), red(i["count"])] for i in under])
    body += table("Teams Over $%s Total Salary" % format(COMMISH_SALARY_FLAG, ",") + (" (%s)" % season if season else ""),
                  [("&nbsp;Team", 250), ("Total Salary", 150), ("Over By", 150)],
                  [["&nbsp;" + link(i["team"]), money(i["salary"]), red(money(i["salary"] - LIMIT))] for i in rich])
    allrows = []
    for i in sorted(info, key=lambda i: i["team"]["name"]):
        c = i["count"]
        allrows.append(["&nbsp;" + link(i["team"]), red(c) if c > COMMISH_MAX_PLAYERS or c < COMMISH_MIN_PLAYERS else c,
                        red(money(i["salary"])) if (i["salary"] or 0) > LIMIT else money(i["salary"])])
    body += table("All Teams", [("&nbsp;Team", 250), ("Players", 100), ("Total Salary", 150)], allrows)
    body += page_foot(d)
    write(os.path.join(d, "CommishCorner.htm"), body)


def patch_menu(d, offseason=False):
    path = os.path.join(d, "menu.htm")
    if not os.path.isfile(path):
        return
    html = read(path)
    if not offseason:
        html = re.sub(r"<tr valign=top><td><a class=menulink target=data href=offseasonfa.htm>.*?</tr>\n?", "", html)
        write(path, html)
    add = ""
    for href, label in (("capreport.htm", "Cap Report"), ("depthchart.htm", "Depth Chart")) + ((("offseasonfa.htm", "Offseason FA"),) if offseason else ()):
        if ("href=" + href) not in html:
            add += "<tr valign=top><td><a class=menulink target=data href=%s>%s</a></td></tr>\n" % (href, label)
    if add:
        i = html.lower().rfind("</table>")
        html = html[:i] + add + html[i:]
    if "href=CommishCorner.htm" not in html:
        pin = ('<div style="position:fixed; bottom:10px; left:11px">'
               '<a class=menulink target=data href=CommishCorner.htm>Commish Corner</a></div>\n')
        i = html.lower().rfind("</body>")
        html = html[:i] + pin + html[i:]
    write(path, html)


def build_depth_chart(d, teams, players):
    data = json.dumps({"teams": teams, "players": players, "attrs": ATTRS}, separators=(",", ":"))
    data = data.replace("</", "<\\/")
    body = page_head(d, "Depth Chart") + page_title("Depth Chart Tool") + DEPTH_HTML.replace("/*DATA*/", data)
    body += page_foot(d)
    write(os.path.join(d, "depthchart.htm"), body)


DEPTH_HTML = r"""
<table border=0 cellspacing=0 cellpadding=0><tr valign=top><td>
<table width=800 border= 0  cellspacing= 0  cellpadding= 0 >
   <tr><td class=tableheader colspan=8>&nbsp;Setup</td></tr>
   <tr align=center>
       <td align=left class=header width=200>&nbsp;My Team (for IR list)</td>
       <td align=left class=header width=200>&nbsp;Player Filter</td>
       <td class=header width=*>&nbsp;</td>
   </tr>
   <tr class=row1>
       <td class=main align=left>&nbsp;<select id=myteam></select></td>
       <td class=main align=left>&nbsp;<select id=filter></select></td>
       <td class=main align=right>
          <input type=button id=clearchg value="Clear Change Toggles">
          <input type=button id=clearbtn value="Clear Depth Chart">&nbsp;
       </td>
   </tr>
</table>
<br>
<table width=800 border= 0  cellspacing= 0  cellpadding= 0 >
   <tr><td class=tableheader colspan=8>&nbsp;Depth Chart</td></tr>
   <tr align=center>
       <td align=left class=header width=50>&nbsp;Slot</td>
       <td align=left class=header width=250>Player</td>
       <td class=header width=50>Pos</td>
       <td class=header width=50>Age</td>
       <td class=header width=50>Ht</td>
       <td class=header width=50>Wt</td>
       <td class=header width=170>Positions</td>
       <td class=header width=80>Minutes</td>
       <td class=header width=60>Change</td>
       <td class=header width=*>&nbsp;</td>
   </tr>
   <tbody id=slots></tbody>
   <tr align=center>
       <td align=left class=header>&nbsp;Total</td>
       <td class=header colspan=6>&nbsp;</td>
       <td class=header id=mintotal>0</td>
       <td class=header>&nbsp;</td>
       <td class=header>&nbsp;</td>
   </tr>
</table>
<br>
<table width=800 border= 0  cellspacing= 0  cellpadding= 0 >
   <tr><td class=tableheader colspan=8>&nbsp;Minutes By Position</td></tr>
   <tr align=center>
       <td class=header width=80>C</td><td class=header width=80>PF</td><td class=header width=80>SF</td>
       <td class=header width=80>SG</td><td class=header width=80>PG</td><td class=header width=*>&nbsp;</td>
   </tr>
   <tr align=center class=row1 id=posmins></tr>
</table>
<br>
<table width=800 border= 0  cellspacing= 0  cellpadding= 0 >
   <tr><td class=tableheader colspan=8>&nbsp;Gameplans</td></tr>
   <tr align=center>
       <td align=left class=header width=170>&nbsp;Offense</td>
       <td align=left class=header width=140>&nbsp;</td>
       <td class=header width=60>Change</td>
       <td class=header width=30>&nbsp;</td>
       <td align=left class=header width=170>&nbsp;Defense</td>
       <td align=left class=header width=110>&nbsp;</td>
       <td class=header width=60>Change</td>
       <td class=header width=*>&nbsp;</td>
   </tr>
   <tbody id=gameplan></tbody>
</table>
<br>
<table width=800 border= 0  cellspacing= 0  cellpadding= 0 >
   <tr><td class=tableheader colspan=8>&nbsp;Attributes</td></tr>
   <tbody id=attrs></tbody>
</table>
<br>
<table width=800 border= 0  cellspacing= 0  cellpadding= 0 >
   <tr><td class=tableheader colspan=8>&nbsp;IR (Not On Depth Chart)</td></tr>
   <tbody id=ir></tbody>
</table>
<br>
</td><td width=15>&nbsp;</td><td>
<div style="position:sticky; top:8px">
<table width=330 border= 0  cellspacing= 0  cellpadding= 0 >
   <tr><td class=tableheader colspan=2>&nbsp;Discord Preview</td></tr>
   <tr><td align=left class=header>&nbsp;Template</td>
       <td align=right class=header><span id=copymsg></span> <input type=button id=copybtn value="Copy to Clipboard">&nbsp;</td></tr>
   <tr class=row1><td class=main colspan=2 style="padding:0"><textarea id=exporttext rows=1 readonly style="display:block; width:100%; box-sizing:border-box; margin:0; overflow:hidden; resize:none"></textarea></td></tr>
</table>
</div>
</td></tr></table>
<br>

<script>
var DATA = /*DATA*/;
(function () {
  var POS = ['C', 'PF', 'SF', 'SG', 'PG'];
  var SLOTS = ['C', 'PF', 'SF', 'SG', 'PG', '6th', '7th', '8th', '9th', '10th', '11th', '12th', '13th'];
  var KEY = 'btbDepthChart';
  var byId = {}, teamName = {};
  DATA.players.forEach(function (p) { byId[p.id] = p; });
  DATA.teams.forEach(function (t) { teamName[t.id] = t.name; });
  teamName.FA = 'Free Agent';

  function blank() {
    var s = { ch: {}, myteam: DATA.teams.length ? String(DATA.teams[0].id) : '', filter: 'ALL', slots: [], gp: {} };
    SLOTS.forEach(function (lbl, i) { s.slots.push({ p: '', pos: i < 5 ? [POS[i]] : [], min: '' }); });
    return s;
  }
  var S;
  try { S = JSON.parse(localStorage.getItem(KEY)); } catch (e) { S = null; }
  if (!S || !S.slots || S.slots.length !== SLOTS.length) S = blank();
  if (!S.ch) S.ch = {};
  // teams can be removed between exports - fall back to a valid team / filter
  if (!DATA.teams.some(function (t) { return String(t.id) === String(S.myteam); })) S.myteam = DATA.teams.length ? String(DATA.teams[0].id) : '';
  if (S.filter !== 'ALL' && S.filter !== 'FA' && !DATA.teams.some(function (t) { return String(t.id) === String(S.filter); })) S.filter = 'ALL';
  S.slots.forEach(function (s) { if (!Array.isArray(s.pos)) s.pos = s.pos ? [s.pos] : []; });
  function save() { try { localStorage.setItem(KEY, JSON.stringify(S)); } catch (e) {} }

  function $(id) { return document.getElementById(id); }
  function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;'); }
  function opt(v, label, sel) { return '<option value="' + esc(v) + '"' + (String(v) === String(sel) ? ' selected' : '') + '>' + esc(label) + '</option>'; }
  function boxCell(c) {
    return c ? '<table border=1 cellpadding=0 cellspacing=0><td bgcolor=' + c + ' width=10 height=10></td></tr></table>' : '&nbsp;';
  }
  function tag(p) { return p.n + ' (' + (p.t === 'FA' ? 'FA' : teamName[p.t]) + ')' + (p.inj ? ' - INJ' : ''); }
  function plink(p) {
    return '<a class=linkmain href=./players/player' + p.id + '.htm>' + esc(p.n) + '</a>' +
      (p.inj ? ' <font color=#FF0000 title="' + esc(p.inj) + '">INJ</font>' : '');
  }

  // ---- setup selects
  var mt = '', ft = opt('ALL', 'All Players', S.filter) + opt('FA', 'Free Agents', S.filter);
  DATA.teams.forEach(function (t) { mt += opt(t.id, t.name, S.myteam); ft += opt(t.id, t.name, S.filter); });
  $('myteam').innerHTML = mt; $('filter').innerHTML = ft;
  $('myteam').onchange = function () { S.myteam = this.value; save(); renderTables(); };
  $('filter').onchange = function () { S.filter = this.value; save(); fillPlayerSelects(); };

  // ---- depth chart rows
  var html = '';
  SLOTS.forEach(function (lbl, i) {
    var po = '';
    POS.forEach(function (x) {
      po += '<label><input type=checkbox id=ps' + i + '_' + x + (S.slots[i].pos.indexOf(x) >= 0 ? ' checked' : '') + '>' + x + '</label> ';
    });
    html += '<tr align=center class=row' + (i % 2 + 1) + '>' +
      '<td class=main align=left>&nbsp;' + lbl + '</td>' +
      '<td class=main align=left><select id=p' + i + ' style="width:240px"></select></td>' +
      '<td class=main id=pp' + i + '>&nbsp;</td><td class=main id=pa' + i + '>&nbsp;</td>' +
      '<td class=main id=ph' + i + '>&nbsp;</td><td class=main id=pw' + i + '>&nbsp;</td>' +
      '<td class=main nowrap>' + po + '</td>' +
      '<td class=main><input id=pm' + i + ' size=3 maxlength=2 value="' + esc(S.slots[i].min) + '"></td>' +
      '<td class=main>' + '<input type=checkbox class=chg data-k="' + 'slot' + i + '"' + (S.ch['slot' + i] ? ' checked' : '') + '>' + '</td>' +
      '<td class=main>&nbsp;</td></tr>';
  });
  $('slots').innerHTML = html;

  function fillPlayerSelects() {
    var pool = DATA.players.filter(function (p) {
      return S.filter === 'ALL' || String(p.t) === String(S.filter);
    }).sort(function (a, b) { return a.n < b.n ? -1 : a.n > b.n ? 1 : 0; });
    SLOTS.forEach(function (lbl, i) {
      var cur = S.slots[i].p, o = opt('', '-- empty --', cur), seen = false;
      if (cur && byId[cur] && pool.indexOf(byId[cur]) < 0) o += opt(cur, tag(byId[cur]), cur); // keep pick visible
      pool.forEach(function (p) { o += opt(p.id, tag(p), cur); });
      $('p' + i).innerHTML = o;
    });
  }

  SLOTS.forEach(function (lbl, i) {
    $('p' + i).onchange = function () {
      var v = this.value;
      if (v) SLOTS.forEach(function (l, j) { if (j !== i && String(S.slots[j].p) === v) { S.slots[j].p = ''; } });
      S.slots[i].p = v;
      if (v && !S.slots[i].pos.length && POS.indexOf(byId[v].pos) >= 0) { S.slots[i].pos = [byId[v].pos]; $('ps' + i + '_' + byId[v].pos).checked = true; }
      save(); fillPlayerSelects(); renderTables();
    };
    POS.forEach(function (x) {
      $('ps' + i + '_' + x).onclick = function () {
        S.slots[i].pos = POS.filter(function (y) { return $('ps' + i + '_' + y).checked; });
        save(); renderTables();
      };
    });
    $('pm' + i).oninput = function () { S.slots[i].min = this.value.replace(/\D/g, ''); save(); renderTables(); };
  });

  // ---- gameplans
  function rng(id) { var o = ''; for (var k = 0; k <= 10; k++) o += opt(k, k, S.gp[id] === undefined ? 5 : S.gp[id]); return '<select id=gp_' + id + '>' + o + '</select>'; }
  function lst(id, items) { var o = ''; items.forEach(function (x) { o += opt(x, x, S.gp[id] === undefined ? items[0] : S.gp[id]); }); return '<select id=gp_' + id + '>' + o + '</select>'; }
  var DEF = ['Man', 'Zone', 'Help', 'Half-Trap'];
  function ck(id) { return id ? '<input type=checkbox class=chg data-k="' + id + '"' + (S.ch[id] ? ' checked' : '') + '>' : '&nbsp;'; }
  var offIds = ['pace', 'motion', 'three', 'focus', 'ocrash', 'fp1', 'fp2', 'fp3'];
  var defIds = ['pdef', 'puse', 'sdef', 'suse', 'press', 'dcrash', '', ''];
  var off = [['Pace', rng('pace')], ['Motion', rng('motion')], ['3PT Usage', rng('three')],
             ['Focus', lst('focus', ['Balanced', 'Inside', 'Outside'])], ['Offensive Crash Boards', rng('ocrash')],
             ['Focus Player 1', '<select id=gp_fp1></select>'], ['Focus Player 2', '<select id=gp_fp2></select>'],
             ['Focus Player 3', '<select id=gp_fp3></select>']];
  var def = [['Primary Defense', lst('pdef', DEF)], ['Primary Usage', rng('puse')],
             ['Secondary Defense', lst('sdef', DEF)], ['Secondary Usage', rng('suse')],
             ['Full Court Press', rng('press')], ['Defensive Crash Boards', rng('dcrash')], ['', ''], ['', '']];
  html = '';
  off.forEach(function (r, i) {
    html += '<tr class=row' + (i % 2 + 1) + '>' +
      '<td class=main align=left>&nbsp;' + r[0] + '</td><td class=main align=left>' + r[1] + '</td>' +
      '<td class=main align=center>' + ck(offIds[i]) + '</td><td class=main>&nbsp;</td>' +
      '<td class=main align=left>&nbsp;' + def[i][0] + '</td><td class=main align=left>' + (def[i][1] || '&nbsp;') + '</td>' +
      '<td class=main align=center>' + ck(defIds[i]) + '</td>' +
      '<td class=main>&nbsp;</td></tr>';
  });
  $('gameplan').innerHTML = html;
  ['pace', 'motion', 'three', 'focus', 'ocrash', 'pdef', 'puse', 'sdef', 'suse', 'press', 'dcrash', 'fp1', 'fp2', 'fp3'].forEach(function (id) {
    var el = $('gp_' + id);
    if (S.gp[id] === undefined && id.indexOf('fp') !== 0) S.gp[id] = el.value;
    el.onchange = function () { S.gp[id] = this.value; save(); buildText(); };
  });

  function fillFocus() {
    ['fp1', 'fp2', 'fp3'].forEach(function (id) {
      var o = opt('', '-- none --', S.gp[id] || '');
      S.slots.forEach(function (s) { if (s.p && byId[s.p]) o += opt(s.p, byId[s.p].n, S.gp[id] || ''); });
      $('gp_' + id).innerHTML = o;
    });
  }

  // ---- attribute / IR tables
  function attrHeader(first) {
    var h = '<tr align=center><td align=left class=header width=50>&nbsp;' + first + '</td>' +
      '<td align=left class=header width=150>Name</td><td class=header width=50>Pos</td><td class=header width=50>Age</td>' +
      '<td class=header width=50>Ht</td><td class=header width=50>Wt</td><td class=header width=40>Cur</td><td class=header width=40>Fut</td>';
    DATA.attrs.forEach(function (a) { h += '<td class=header width=40>' + a + '</td>'; });
    return h + '<td class=header width=*>&nbsp;</td></tr>';
  }
  function attrRow(label, p, k) {
    var r = '<tr align=center class=row' + (k % 2 + 1) + '><td align=left class=main>&nbsp;' + label + '</td>' +
      '<td align=left class=main>' + plink(p) + '</td><td class=main>' + p.pos + '</td><td class=main>' + p.age + '</td>' +
      '<td class=main>' + p.ht + '</td><td class=main>' + p.wt + '</td>' +
      '<td class=main>' + boxCell(p.cur) + '</td><td class=main>' + boxCell(p.fut) + '</td>';
    p.a.forEach(function (v) { r += '<td class=main>' + v + '</td>'; });
    return r + '<td class=main>&nbsp;</td></tr>';
  }

  function renderTables() {
    var total = 0, pm = { C: 0, PF: 0, SF: 0, SG: 0, PG: 0 }, used = {}, rowsA = '', k = 0;
    SLOTS.forEach(function (lbl, i) {
      var s = S.slots[i], p = s.p && byId[s.p];
      $('pp' + i).innerHTML = p ? p.pos : '&nbsp;';
      $('pa' + i).innerHTML = p ? p.age : '&nbsp;';
      $('ph' + i).innerHTML = p ? p.ht : '&nbsp;';
      $('pw' + i).innerHTML = p ? p.wt : '&nbsp;';
      var m = parseInt(s.min, 10) || 0;
      total += m;
      if (s.pos.length) s.pos.forEach(function (x) { pm[x] += m / s.pos.length; });
      if (p) { used[p.id] = 1; rowsA += attrRow(lbl, p, k++); }
    });
    $('mintotal').innerHTML = total === 240 ? total : '<font color=#FF0000>' + total + '</font>';
    $('mintotal').title = 'Regulation game = 240 minutes';
    var pmh = '';
    POS.forEach(function (x) { pm[x] = Math.round(pm[x] * 10) / 10; pmh += '<td class=main>' + (pm[x] === 48 ? pm[x] : '<font color=#FF0000>' + pm[x] + '</font>') + '</td>'; });
    $('posmins').innerHTML = pmh + '<td class=main>&nbsp;</td>';
    $('attrs').innerHTML = attrHeader('Slot') + (rowsA || '<tr class=row1><td class=main colspan=25>&nbsp;No players on the depth chart</td></tr>');
    var ir = '', j = 0;
    DATA.players.forEach(function (p) {
      if (String(p.t) === String(S.myteam) && !used[p.id]) ir += attrRow('IR', p, j++);
    });
    $('ir').innerHTML = attrHeader('&nbsp;') + (ir || '<tr class=row1><td class=main colspan=25>&nbsp;None</td></tr>');
    fillFocus();
    buildText();
  }

  $('clearbtn').onclick = function () {
    if (!confirm('Clear the whole depth chart and gameplan?')) return;
    var keep = { myteam: S.myteam, filter: S.filter };
    S = blank(); S.myteam = keep.myteam; S.filter = keep.filter; save(); location.reload();
  };
  Array.prototype.forEach.call(document.querySelectorAll('input.chg'), function (c) {
    c.onclick = function () { if (this.checked) S.ch[this.getAttribute('data-k')] = 1; else delete S.ch[this.getAttribute('data-k')]; save(); buildText(); };
  });
  $('clearchg').onclick = function () {
    S.ch = {}; save();
    Array.prototype.forEach.call(document.querySelectorAll('input.chg'), function (c) { c.checked = false; });
    buildText();
  };
  function mark(k, line) { return S.ch[k] ? '**' + line + '**' : line; }
  function buildText() {
    var irNames = [];
    DATA.players.forEach(function (p) {
      if (String(p.t) === String(S.myteam) && !S.slots.some(function (s) { return String(s.p) === String(p.id); })) irNames.push(p.n);
    });
    var t = '**IR:** ' + (irNames.length ? irNames.join(', ') : 'None') + '\n\n';
    SLOTS.forEach(function (lbl, i) {
      var s = S.slots[i], p = s.p && byId[s.p];
      if (!p) return;
      t += mark('slot' + i, lbl + ': ' + p.n + '/' + (s.pos.length ? s.pos.join('/') : '-') + '/' + (parseInt(s.min, 10) || 0)) + '\n';
    });
    function v(id) { var e = $('gp_' + id); return e && e.options[e.selectedIndex] ? e.options[e.selectedIndex].text : ''; }
    var fps = ['fp1', 'fp2', 'fp3'].map(function (id) { return S.gp[id] && byId[S.gp[id]] ? mark(id, byId[S.gp[id]].n) : ''; })
      .filter(function (x) { return x; });
    function L(label, id) { return mark(id, label + ': ' + v(id)) + '\n'; }
    t += '\n**Gameplan:**\n**Offense:**\n' + L('Pace', 'pace') + L('Motion', 'motion') + L('3pt Usage', 'three') +
      L('Focus', 'focus') + L('Crash Boards', 'ocrash') +
      '\n**Defense:**\n' + L('Primary', 'pdef') + L('Usage', 'puse') + L('Secondary', 'sdef') + L('Usage', 'suse') +
      L('Full Court Press', 'press') + L('Crash Boards', 'dcrash') +
      '\n**Focus Players:**\n' + (fps.length ? fps.join('\n') : 'None');
    $('exporttext').value = t;
    var ta = $('exporttext'); ta.style.height = 'auto'; ta.style.height = (ta.scrollHeight + 2) + 'px';
  }
  $('copybtn').onclick = function () {
    var ta = $('exporttext'), msg = $('copymsg');
    function done() { msg.innerHTML = 'Copied!'; setTimeout(function () { msg.innerHTML = ''; }, 2500); }
    function fallback() { ta.select(); try { document.execCommand('copy'); done(); } catch (e) { msg.innerHTML = 'Press Ctrl+C to copy.'; } }
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(ta.value).then(done, fallback);
    else fallback();
  };

  fillPlayerSelects();
  renderTables();
  save();
})();
</script>
"""


def last_played(d, player_id):
    """(season, team abbreviation) of the most recent league season the player has stats for."""
    path = os.path.join(d, "players", "player%d.htm" % player_id)
    if not os.path.isfile(path):
        return None
    best = None
    for c in rows(section(read(path), "Season Averages")):
        if len(c) < 4:
            continue
        yr, abbr, games = clean(c[0]), clean(c[2]), clean(c[3])
        if not yr.isdigit() or not abbr or not games.isdigit() or int(games) == 0:
            continue
        if best is None or int(yr) > best[0]:
            best = (int(yr), abbr)
    return best


def team_abbreviations(d, teams, players):
    """Work out each team's abbreviation (BOS, POR...) from what its current players' pages show."""
    from collections import Counter
    votes = {}
    for p in players:
        if p["t"] == "FA":
            continue
        lp = last_played(d, p["id"])
        if lp:
            votes.setdefault(lp[1], Counter())[p["t"]] += 1
    return {abbr: c.most_common(1)[0][0] for abbr, c in votes.items()}


def parse_date(t):
    """Transaction dates come as 7/25/2007, 2007-10-16 or 1.02.2005. Returns (y, m, d) or None."""
    t = t.strip()
    m = re.match(r"^(\d{4})-(\d{1,2})-(\d{1,2})$", t)
    if m:
        return (int(m.group(1)), int(m.group(2)), int(m.group(3)))
    m = re.match(r"^(\d{1,2})/(\d{1,2})/(\d{4})$", t)
    if m:
        return (int(m.group(3)), int(m.group(1)), int(m.group(2)))
    m = re.match(r"^(\d{1,2})\.(\d{1,2})\.(\d{4})$", t)
    if m:
        return (int(m.group(3)), int(m.group(2)), int(m.group(1)))
    return None


def previous_team(d, player_id, abbr_map, teams):
    """Who a free agent counts as a previous player for:
       - start with the team he last played games for;
       - then, for moves after that season ended (in order):
           drafted / signed / re-signed  -> that team (even with no games played)
           traded to a team              -> nobody, unless he went on to play for them that season
           released / waived             -> nobody"""
    lp = last_played(d, player_id)
    path = os.path.join(d, "players", "player%d.htm" % player_id)
    state = None
    season = None
    if lp:
        season = lp[0]
        abbr = lp[1] if lp[1] in abbr_map else TEAM_ABBREVIATION_ALIASES.get(lp[1], lp[1])
        state = abbr_map.get(abbr)
    played_for = state
    names = sorted(teams, key=lambda t: -len(t["name"]))

    def team_in(txt):
        for t in names:
            if t["name"] in txt:
                return t["id"]
        return None

    if os.path.isfile(path):
        for c in rows(section(read(path), "Transactions")):
            if len(c) < 2:
                continue
            when, what = parse_date(clean(c[0])), clean(c[1])
            if season is not None and when is not None and when < (season + 1, 7, 1):
                continue                       # up to the end of his last season - already reflected above
            in_last_season = season is not None and when is not None and when <= (season + 1, 6, 30)
            if re.match(r"(Signed|Re-signed|Drafted)\b", what, re.I) and "extension" not in what.lower():
                state = team_in(what)
            elif re.match(r"Traded to\b", what, re.I):
                to = team_in(what)
                state = to if (in_last_season and to is not None and to == played_for) else None
            elif re.match(r"(Released|Waived)\b", what, re.I):
                state = None
    return state


def build_offseason_fa(d, teams, players):
    abbr_map = team_abbreviations(d, teams, players)
    fas = []
    for p in players:
        if p["t"] == "FA":
            q = dict(p)
            q["prev"] = previous_team(d, p["id"], abbr_map, teams)
            fas.append(q)
    if SPENDING_LIMIT:
        for t in teams:
            t["cap"] = SPENDING_LIMIT
    rules = {"limits": {str(k): v for k, v in FA_BID_LIMITS.items()}, "maxSal": MAX_STARTING_SALARY,
             "yrs": [MAX_YEARS_NON_BIRD, MAX_YEARS_BIRD], "raise": [MAX_RAISE_NON_BIRD, MAX_RAISE_BIRD], "step": RAISE_STEP, "minRounds": MIN_OFFER_ROUNDS}
    data = json.dumps({"teams": teams, "fas": fas, "attrs": ATTRS, "rules": rules}, separators=(",", ":")).replace("</", "<\\/")
    sort_js = SCRIPT.replace(MARKER, "")
    body = page_head(d, "Offseason FA") + page_title("Offseason FA") + FA_HTML.replace("/*DATA*/", data) + sort_js
    body += page_foot(d)
    write(os.path.join(d, "offseasonfa.htm"), body)


FA_HTML = r"""
<table width=800 border= 0  cellspacing= 0  cellpadding= 0 >
   <tr><td class=tableheader colspan=8>&nbsp;Setup</td></tr>
   <tr align=center>
       <td align=left class=header width=170>&nbsp;Team</td>
       <td align=left class=header width=80>&nbsp;FA Round</td>
       <td align=left class=header width=110>&nbsp;Bids Used</td>
       <td align=left class=header width=150>&nbsp;Current Salary</td>
       <td align=left class=header width=120>&nbsp;Cap Room</td>
       <td class=header width=*>&nbsp;</td>
   </tr>
   <tr class=row1>
       <td class=main align=left>&nbsp;<select id=team></select></td>
       <td class=main align=left>&nbsp;<select id=round>
           <option value=1>FA 1</option><option value=2>FA 2</option><option value=3>FA 3</option></select></td>
       <td class=main align=left>&nbsp;<span id=bidcount></span></td>
       <td class=main align=left nowrap>&nbsp;<input id=salover size=12 title="From the Cap Report. Type a new figure if a trade has changed it.">
           <input type=button id=salreset value="Reset" title="Go back to the Cap Report figure"></td>
       <td class=main align=left>&nbsp;<span id=caproom></span></td>
       <td class=main align=right><input type=button id=clearbtn value="Clear Selections">&nbsp;</td>
   </tr>
</table>
<br>
<table border=0 cellspacing=0 cellpadding=0><tr valign=top><td>
<table width=800 border= 0  cellspacing= 0  cellpadding= 0 >
   <tr><td class=tableheader colspan=8>&nbsp;Bids</td></tr>
   <tr align=center>
       <td align=left class=header width=25>&nbsp;#</td>
       <td align=left class=header width=170>Name</td>
       <td class=header width=45>Bird</td>
       <td class=header width=45>Min</td>
       <td class=header width=140>Starting Salary</td>
       <td class=header width=80>Years</td>
       <td class=header width=90>Raise</td>
       <td class=header width=120>Option</td>
       <td class=header width=*>&nbsp;</td>
   </tr>
   <tbody id=bidtbl></tbody>
   <tr align=center>
       <td align=left class=header colspan=4>&nbsp;Non-Bird Total (excludes min offers)</td>
       <td class=header id=bidtotal>$0</td>
       <td class=header colspan=4>&nbsp;</td>
   </tr>
</table>
<br>
<table width=800 border= 0  cellspacing= 0  cellpadding= 0 >
   <tr><td class=tableheader colspan=8>&nbsp;Previous Players</td></tr>
   <tbody id=prevtbl></tbody>
</table>
<br>
<table width=800 border= 0  cellspacing= 0  cellpadding= 0 >
   <tr><td class=tableheader colspan=8>&nbsp;Free Agents</td></tr>
   <tbody id=fatbl></tbody>
</table>
<br>
</td><td width=15>&nbsp;</td><td>
<div style="position:sticky; top:8px">
<table width=380 border= 0  cellspacing= 0  cellpadding= 0 >
   <tr><td class=tableheader colspan=2>&nbsp;Discord Preview</td></tr>
   <tr><td align=left class=header>&nbsp;Template</td>
       <td align=right class=header><span id=copymsg></span> <input type=button id=copybtn value="Copy to Clipboard">&nbsp;</td></tr>
   <tr class=row1><td class=main colspan=2 style="padding:0"><textarea id=exporttext rows=1 readonly style="display:block; width:100%; box-sizing:border-box; margin:0; overflow:hidden; resize:none"></textarea></td></tr>
</table>
</div>
</td></tr></table>
<br>

<script>
var DATA = /*DATA*/;
(function () {
  var R = DATA.rules, LIMIT = R.limits, MAXSAL = R.maxSal;
  var KEY = 'swbaOffseasonFA';
  var byId = {}, teamById = {};
  DATA.fas.forEach(function (p) { byId[p.id] = p; });
  DATA.teams.forEach(function (t) { teamById[t.id] = t; });
  var S;
  try { S = JSON.parse(localStorage.getItem(KEY)); } catch (e) { S = null; }
  if (!S || !S.sel) S = { team: DATA.teams.length ? String(DATA.teams[0].id) : '', round: '1', sel: {} };
  if (!S.bid) S.bid = {};
  if (!DATA.teams.some(function (t) { return String(t.id) === String(S.team); })) S.team = DATA.teams.length ? String(DATA.teams[0].id) : '';
  if (!S.bird) S.bird = {};
  if (!S.salOver) S.salOver = {};
  Object.keys(S.sel).forEach(function (k) { if (!byId[k]) { delete S.sel[k]; delete S.bid[k]; } }); // signed elsewhere since
  function save() { try { localStorage.setItem(KEY, JSON.stringify(S)); } catch (e) {} }
  function $(id) { return document.getElementById(id); }
  function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;'); }
  function money(n) { return (n < 0 ? '-' : '') + '$' + Math.abs(Math.round(n)).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ','); }
  function parseMoney(s) { var n = parseInt(String(s).replace(/[^\d]/g, ''), 10); return isNaN(n) ? 0 : n; }
  function boxCell(c) {
    return c ? '<table border=1 cellpadding=0 cellspacing=0><td bgcolor=' + c + ' width=10 height=10></td></tr></table>' : '&nbsp;';
  }
  function isPrev(p) { return String(p.prev) === String(S.team); }
  function hasBird(id) { return !!(S.bird[S.team] && S.bird[S.team][id]) && isPrev(byId[id]); }
  function bidsUsed() {
    return Object.keys(S.sel).filter(function (k) { return byId[k] && !isPrev(byId[k]); }).length;
  }
  function lastName(n) {
    var parts = n.replace(/\s+(Jr\.?|Sr\.?|II|III|IV|V)$/i, '').split(/\s+/);
    return (parts[parts.length - 1] + ' ' + parts.slice(0, -1).join(' ')).toLowerCase();
  }
  function sortedSel() {
    return Object.keys(S.sel).filter(function (k) { return byId[k]; })
      .sort(function (a, b) { var x = lastName(byId[a].n), y = lastName(byId[b].n); return x < y ? -1 : x > y ? 1 : 0; });
  }
  function bidOf(id) {
    if (!S.bid[id]) S.bid[id] = { min: false, sal: '', yrs: '1', raise: '0', opt: 'None' };
    var b = S.bid[id], bird = hasBird(id);
    if (!minsAllowed()) { b.min = false; b.forced = false; }              // no min offers this round
    else if (!bird && capRoom() <= 0) { if (!b.min) b.forced = true; b.min = true; } // over the soft cap: min offers only
    else if (b.forced) { b.min = false; b.forced = false; }
    var maxY = R.yrs[bird ? 1 : 0], maxR = R.raise[bird ? 1 : 0];
    if (+b.yrs > maxY) b.yrs = String(maxY);
    if (Math.abs(+b.raise) > maxR) b.raise = String(+b.raise > 0 ? maxR : -maxR);
    if (b.min) { b.yrs = '1'; b.raise = '0'; b.opt = 'None'; } // min deals: 1 year, no raise, no option
    return b;
  }
  function team() { return teamById[S.team] || {}; }
  function minsAllowed() { return R.minRounds.indexOf(+S.round) >= 0; }
  // over the soft cap in a round with no mins: a non-Bird player can't be offered anything
  function blocked(id) { return !minsAllowed() && !hasBird(id) && capRoom() <= 0; }
  function curSalary() {
    var o = S.salOver[S.team];
    return (o !== undefined && o !== '') ? parseMoney(o) : (team().sal || 0);
  }
  function capRoom() { var t = team(); return (t.cap || 0) - curSalary(); }

  var o = '';
  DATA.teams.forEach(function (t) { o += '<option value="' + t.id + '"' + (String(t.id) === String(S.team) ? ' selected' : '') + '>' + esc(t.name) + '</option>'; });
  $('team').innerHTML = o;
  $('round').value = S.round;
  $('team').onchange = function () { S.team = this.value; save(); showSalary(); render(); };
  $('round').onchange = function () { S.round = this.value; save(); renderBids(); };
  function showSalary() { $('salover').value = money(curSalary()); }
  $('salover').onchange = function () { S.salOver[S.team] = String(parseMoney(this.value)); this.value = money(curSalary()); save(); renderBids(); };
  $('salreset').onclick = function () { delete S.salOver[S.team]; save(); showSalary(); renderBids(); };
  showSalary();

  function header(prev) {
    var h = '<tr align=center><td align=left class=header width=25>&nbsp;</td>' +
      '<td align=left class=header width=150 data-lastname=1>Name</td><td class=header width=50>Pos</td><td class=header width=50>Age</td>' +
      '<td class=header width=50>Ht</td><td class=header width=50>Wt</td><td class=header width=40>Cur</td><td class=header width=40>Fut</td>';
    DATA.attrs.forEach(function (a) { h += '<td class=header width=40>' + a + '</td>'; });
    return h + '<td class=header width=*>&nbsp;</td></tr>';
  }
  function row(p, k, prev) {
    var r = '<tr align=center class=row' + (k % 2 + 1) + '>' +
      '<td align=left class=main><input type=checkbox class=pick data-id="' + p.id + '"' + (S.sel[p.id] ? ' checked' : '') + '></td>' +
      '<td align=left class=main><a class=linkmain href=./players/player' + p.id + '.htm>' + esc(p.n) + '</a></td>' +
      '<td class=main>' + p.pos + '</td><td class=main>' + p.age + '</td><td class=main>' + p.ht + '</td><td class=main>' + p.wt + '</td>' +
      '<td class=main>' + boxCell(p.cur) + '</td><td class=main>' + boxCell(p.fut) + '</td>';
    p.a.forEach(function (v) { r += '<td class=main>' + v + '</td>'; });
    return r + '<td class=main>&nbsp;</td></tr>';
  }
  function render() {
    var prev = '', rest = '', i = 0, j = 0;
    DATA.fas.forEach(function (p) { if (isPrev(p)) prev += row(p, i++, true); else rest += row(p, j++, false); });
    $('prevtbl').innerHTML = header(true) + (prev || '<tr class=row1><td class=main colspan=25>&nbsp;None</td></tr>');
    $('fatbl').innerHTML = header(false) + (rest || '<tr class=row1><td class=main colspan=25>&nbsp;None</td></tr>');
    Array.prototype.forEach.call(document.querySelectorAll('input.pick'), function (c) {
      c.onclick = function () {
        var id = this.getAttribute('data-id'), p = byId[id];
        if (this.checked && !isPrev(p) && bidsUsed() >= LIMIT[S.round]) {
          this.checked = false;
          alert('FA ' + S.round + ' allows ' + LIMIT[S.round] + ' bids (plus previous players).');
          return;
        }
        if (this.checked) S.sel[id] = 1; else delete S.sel[id];
        save(); renderBids();
      };
    });
    if (window.sortInit) sortInit();
    renderBids();
  }

  function sel(cls, id, opts, val, dis) {
    var h = '<select class="' + cls + '" data-id="' + id + '"' + (dis ? ' disabled style="background:#C0C0C0"' : '') + '>';
    opts.forEach(function (x) { h += '<option value="' + x[0] + '"' + (String(x[0]) === String(val) ? ' selected' : '') + '>' + x[1] + '</option>'; });
    return h + '</select>';
  }
  function raiseLabel(v) { v = +v; return (v > 0 ? '+' : '') + v + '%'; }
  function renderBids() {
    var ids = sortedSel(), h = '';
    ids.forEach(function (id, k) {
      var p = byId[id], b = bidOf(id), bird = hasBird(id);
      var yrs = [], rs = [], maxY = R.yrs[bird ? 1 : 0], maxR = R.raise[bird ? 1 : 0];
      for (var y = 1; y <= maxY; y++) yrs.push([y, y + (y === 1 ? ' year' : ' years')]);
      for (var r = maxR; r >= -maxR - 1e-9; r = Math.round((r - R.step) * 1000) / 1000) rs.push([r, raiseLabel(r)]);
      h += '<tr align=center class=row' + (k % 2 + 1) + '>' +
        '<td align=left class=main>&nbsp;' + (k + 1) + '</td>' +
        '<td align=left class=main>' + esc(p.n) + '</td>' +
        '<td class=main>' + (isPrev(p) ? '<input type=checkbox class=bbird data-id="' + id + '"' + (bird ? ' checked' : '') +
          ' title="Tick if you hold Bird rights on this player">' : '&nbsp;') + '</td>' +
        '<td class=main><input type=checkbox class=bmin data-id="' + id + '"' + (b.min ? ' checked' : '') +
          (!minsAllowed() ? ' disabled title="No min offers in FA ' + S.round + '"' :
           (!bird && capRoom() <= 0 ? ' disabled title="Over the soft cap - min offers only for non-Bird players"' : '')) + '></td>' +
        (blocked(id) ? '<td class=main><font color=#FF0000>Over cap - no mins in FA ' + S.round + '</font></td>' :
        '<td class=main><input class=bsal data-id="' + id + '" size=13 value="' + esc(b.min ? '' : (b.sal ? money(parseMoney(b.sal)) : '')) + '"' +
          (b.min ? ' disabled placeholder="Min offer" style="background:#C0C0C0"' : ' placeholder="$0"') + '></td>') +
        '<td class=main>' + sel('byrs', id, yrs, b.yrs, b.min || blocked(id)) + '</td>' +
        '<td class=main>' + sel('braise', id, rs, b.raise, b.min || blocked(id)) + '</td>' +
        '<td class=main>' + sel('bopt', id, [['None', 'None'], ['Team Option', 'Team Option'], ['Player Option', 'Player Option']], b.opt, b.min || blocked(id)) + '</td>' +
        '<td class=main>&nbsp;</td></tr>';
    });
    $('bidtbl').innerHTML = h || '<tr class=row1><td class=main colspan=9>&nbsp;Tick players below to add them to your bids</td></tr>';
    function wire(cls, ev, fn) {
      Array.prototype.forEach.call(document.querySelectorAll('#bidtbl .' + cls), function (el) {
        el[ev] = function () { fn(this, S.bid[this.getAttribute('data-id')]); save(); update(); };
      });
    }
    wire('bbird', 'onclick', function (el) {
      var id = el.getAttribute('data-id');
      if (!S.bird[S.team]) S.bird[S.team] = {};
      if (el.checked) S.bird[S.team][id] = 1; else delete S.bird[S.team][id];
      save(); renderBids();
    });
    wire('bmin', 'onclick', function (el, b) { b.min = el.checked; b.forced = false; save(); renderBids(); });
    wire('bsal', 'oninput', function (el, b) { b.sal = String(parseMoney(el.value)); });
    wire('bsal', 'onchange', function (el, b) {
      var n = parseMoney(el.value);
      if (n > MAXSAL) { n = MAXSAL; alert('Starting salary is capped at ' + money(MAXSAL) + '.'); }
      b.sal = n ? String(n) : ''; el.value = n ? money(n) : '';
    });
    wire('byrs', 'onchange', function (el, b) { b.yrs = el.value; });
    wire('braise', 'onchange', function (el, b) { b.raise = el.value; });
    wire('bopt', 'onchange', function (el, b) { b.opt = el.value; });
    update();
  }

  function update() {
    var used = bidsUsed(), lim = LIMIT[S.round];
    var prevCount = Object.keys(S.sel).filter(function (k) { return byId[k] && isPrev(byId[k]); }).length;
    $('bidcount').innerHTML = (used > lim ? '<font color=#FF0000>' + used + '</font>' : used) + ' / ' + lim +
      (prevCount ? ' &nbsp;+ ' + prevCount + ' prev' : '');
    var room = capRoom(), total = 0, ids = sortedSel();
    ids.forEach(function (id) { var b = bidOf(id); if (!b.min && !hasBird(id) && !blocked(id)) total += Math.min(parseMoney(b.sal), MAXSAL); });
    var valid = ids.filter(function (id) { return !blocked(id); });
    $('caproom').innerHTML = room <= 0 ? '<font color=#FF0000>Over cap - mins only</font>' : money(room);
    $('bidtotal').innerHTML = total > Math.max(room, 0) ? '<font color=#FF8080>' + money(total) + ' (over cap room)</font>' : money(total);
    var t = '**' + (team().name || '') + ' - FA ' + S.round + '**\n';
    t += valid.length ? valid.map(function (id, i) {
      var b = bidOf(id);
      var sal = b.min ? 'Min' : money(Math.min(parseMoney(b.sal), MAXSAL));
      return (i + 1) + '. ' + byId[id].n + ' - ' + sal + ' - ' + b.yrs + (+b.yrs === 1 ? ' year' : ' years') +
        ' - ' + raiseLabel(b.raise) + ' - ' + b.opt;
    }).join('\n') : 'None';
    $('exporttext').value = t;
    var ta = $('exporttext'); ta.style.height = 'auto'; ta.style.height = (ta.scrollHeight + 2) + 'px';
  }
  $('clearbtn').onclick = function () {
    if (!confirm('Clear all selected free agents?')) return;
    S.sel = {}; S.bid = {}; save(); render();
  };
  $('copybtn').onclick = function () {
    var ta = $('exporttext'), msg = $('copymsg');
    function done() { msg.innerHTML = 'Copied!'; setTimeout(function () { msg.innerHTML = ''; }, 2500); }
    function fallback() { ta.select(); try { document.execCommand('copy'); done(); } catch (e) { msg.innerHTML = 'Press Ctrl+C to copy.'; } }
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(ta.value).then(done, fallback);
    else fallback();
  };
  render();
})();
</script>
"""


def build_extras(d, offseason=False):
    if not os.path.isfile(os.path.join(d, "capreport.htm")):
        print("capreport.htm not found - skipping Depth Chart / Commish Corner")
        return
    teams, players, info = collect(d)
    build_depth_chart(d, teams, players)
    build_commish(d, info)
    if offseason:
        build_offseason_fa(d, teams, players)
    else:
        old = os.path.join(d, "offseasonfa.htm")
        if os.path.isfile(old):
            os.remove(old)
    patch_menu(d, offseason)
    print("Built depthchart.htm (%d players), CommishCorner.htm%s; sidebar updated" % (len(players), " and offseasonfa.htm" if offseason else ""))


def find_html_dir(root):
    for cand in (root, os.path.join(root, "html")):
        if os.path.isfile(os.path.join(cand, "freeagents.htm")):
            return cand
    for dp, _, fs in os.walk(root):
        if "freeagents.htm" in fs:
            return dp
    sys.exit("Could not find freeagents.htm under " + root)


def patch_dir(root, offseason=False):
    d = find_html_dir(root)
    targets = [os.path.join(d, n) for n in ("freeagents.htm", "potentialfreeagents.htm", "draft.htm")]
    rdir = os.path.join(d, "rosters")
    if os.path.isdir(rdir):
        targets += [os.path.join(rdir, n) for n in sorted(os.listdir(rdir)) if n.lower().endswith(".htm")]
    done = 0
    for t in targets:
        if os.path.isfile(t) and patch_file(t):
            done += 1
    print("Patched %d page(s) in %s (%d already done or missing)" % (done, d, len(targets) - done))
    build_extras(d, offseason)


def preview(root, port=8200):
    """Serve the site locally with caching turned off, so every page is always fresh."""
    import http.server, functools, webbrowser, threading

    class NoCache(http.server.SimpleHTTPRequestHandler):
        def end_headers(self):
            self.send_header("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0")
            self.send_header("Pragma", "no-cache")
            self.send_header("Expires", "0")
            super().end_headers()

        def log_message(self, *a):
            pass

    handler = functools.partial(NoCache, directory=root)
    srv = None
    for p in range(port, port + 50):  # skip ports still held by an older preview window
        try:
            srv = http.server.ThreadingHTTPServer(("127.0.0.1", p), handler)
            port = p
            break
        except OSError:
            continue
    if srv is None:
        sys.exit("Couldn't find a free port for the preview.")
    url = "http://localhost:%d/index.htm" % port
    print("Previewing the site at " + url)
    print("Close this window when you're done.")
    threading.Timer(0.5, lambda: webbrowser.open(url)).start()
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        pass


def main():
    if "--preview" in sys.argv[1:]:
        rest = [a for a in sys.argv[1:] if a != "--preview"]
        preview(find_html_dir(os.path.abspath(rest[0] if rest else ".")))
        return
    args = [a for a in sys.argv[1:] if a != "--offseason"]
    offseason = "--offseason" in sys.argv[1:]
    if len(args) != 1:
        sys.exit(__doc__)
    p = args[0]
    if zipfile.is_zipfile(p):
        tmp = tempfile.mkdtemp()
        with zipfile.ZipFile(p) as z:
            z.extractall(tmp)
        patch_dir(tmp, offseason)
        out = p + ".tmp"
        with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as z:
            for dp, _, fs in os.walk(tmp):
                for f in fs:
                    full = os.path.join(dp, f)
                    z.write(full, os.path.relpath(full, tmp))
        os.replace(out, p)
        shutil.rmtree(tmp)
    else:
        patch_dir(p, offseason)


if __name__ == "__main__":
    main()
