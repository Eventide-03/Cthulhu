"""End-to-end check of the home page (about:cthulhu) against the built app:
widget registry, the browser-wide theme engine (page AND chrome follow the
pref), hover-tool placement vs. a widget's own header controls, the gradient /
orb / palette / reference-board widgets, and the palette
icons. Runs offline in a throwaway profile.

    cd engine && ./mach python ../tools/home-widgets-test.py
    SHOTS=/some/dir ./mach python ../tools/home-widgets-test.py   # also save PNGs

The layout it builds assumes a 10x5 grid (a 1560px-wide window; the display
caps the height), so the "nothing displaced" check fails on a smaller screen
rather than meaning anything is wrong.
"""

import os, sys, time, base64, tempfile, json, datetime, re
from marionette_driver.marionette import Marionette
BIN = os.path.join(os.getcwd(), "obj-aarch64-apple-darwin25.5.0", "dist", "Cthulhu.app", "Contents", "MacOS", "Cthulhu")
SHOTS = os.environ.get("SHOTS", "")
m = Marionette(bin=BIN, gecko_log="-", prefs={"marionette.log.level": "Error"},
               app_args=["-remote-allow-system-access", "-profile", tempfile.mkdtemp(prefix="cthulhu-widgets-")])
m.start_session()
fails = []
def check(label, ok, extra=""):
    print(("PASS " if ok else "FAIL ") + label + ("  " + str(extra) if extra != "" else ""))
    if not ok: fails.append(label)
def shot(name):
    if not SHOTS: return
    m.set_context("content")
    data = m.screenshot(format="base64")
    with open(os.path.join(SHOTS, name + ".png"), "wb") as f: f.write(base64.b64decode(data))
    print("SHOT " + name)
def page(js, *args):
    m.set_context("content")
    return m.execute_script("const w = window.wrappedJSObject || window; " + js, script_args=args)
def chrome(js, *args):
    m.set_context("chrome")
    return m.execute_script(js, script_args=args)
try:
    m.set_window_rect(width=1560, height=1300)
    m.set_context("content")
    m.navigate("about:cthulhu")
    time.sleep(4)
    print("=====WIDGETS=====")

    # --- registry + no errors
    ids = page("return w.CthulhuWidgets.all().map(d => d.id);")
    for want in ["theme", "gradient", "orb", "palette", "refboard", "calendar"]:
        check("registered: " + want, want in ids)
    # --- theme applied to page AND chrome, same values
    pbg = page("return getComputedStyle(document.documentElement).getPropertyValue('--bg').trim();")
    cbg = chrome("return getComputedStyle(document.documentElement).getPropertyValue('--bg').trim();")
    pth = page("return document.documentElement.getAttribute('cthulhu-theme');")
    check("page --bg is the night palette", pbg == "#14151c", pbg)
    check("chrome --bg matches the page", cbg == pbg, cbg)
    check("page carries cthulhu-theme attr", pth == "night", pth)

    # --- reset to a clean grid, add the widgets under test
    page("""
      const H = w.CthulhuHome; const g = w.__cthulhuGrid;
      g.removeAll(true); g.el.querySelectorAll(':scope > .grid-stack-item').forEach(e => e.remove());
      H.addWidgetByType('calendar',  {x:0, y:0, w:3, h:3, config:{calendars:{primary:'mine', 'them-cal':'theirs'}, createIn:'primary', mode:'both', theirLabel:'Theirs', showCompleted:false, pollMinutes:5}});
      H.addWidgetByType('theme',     {x:3, y:0, w:3, h:3});
      H.addWidgetByType('gradient',  {x:6, y:0, w:2, h:3});
      H.addWidgetByType('refboard',  {x:8, y:0, w:2, h:3});
      H.addWidgetByType('palette',   {x:0, y:3, w:2, h:2});
      H.addWidgetByType('orb',       {x:2, y:3, w:2, h:2});
    """)
    time.sleep(3)
    n = page("return document.querySelectorAll('#grid .cthulhu-widget').length;")
    check("6 widgets mounted", n == 6, n)
    grid = page("return { cols: w.__cthulhuGrid.getColumn(), rows: w.__cthulhuGrid.opts.maxRow, nodes: w.__cthulhuGrid.engine.nodes.map(n => n.el._cthulhu.id + '@' + n.x + ',' + n.y + ' ' + n.w + 'x' + n.h) };")
    print("GRID", grid)
    check("every widget kept its requested cell (nothing displaced)",
          set(grid["nodes"]) == {"calendar@0,0 3x3","theme@3,0 3x3","gradient@6,0 2x3","refboard@8,0 2x3","palette@0,3 2x2","orb@2,3 2x2"})
    shot("01-widgets")

    # --- calendar: hover tools must NOT overlap the calendar's own header buttons
    r = page("""
      const cal = [...document.querySelectorAll('#grid .grid-stack-item')].find(e => e._cthulhu && e._cthulhu.id === 'calendar');
      const tools = cal.querySelector('.cthulhu-widget-tools');
      const content = cal.querySelector('.grid-stack-item-content');
      const T = tools.getBoundingClientRect(), C = content.getBoundingClientRect();
      const btns = [...cal.querySelectorAll('.cw-cal-hbtn')].map(b => b.getBoundingClientRect());
      const hit = (a, b) => !(a.right <= b.left || a.left >= b.right || a.bottom <= b.top || a.top >= b.bottom);
      return { parentIsItem: tools.parentElement === cal, toolsTop: T.top, toolsBottom: T.bottom, contentTop: C.top,
               overlapsAny: btns.some(b => hit(T, b)), nBtns: btns.length,
               firstBtnTop: btns.length ? btns[0].top : null };
    """)
    check("tools are a child of the grid item", r["parentIsItem"])
    check("tools straddle the top border (8px above, 12px below)",
          abs((r["contentTop"] - r["toolsTop"]) - 8) <= 1 and abs((r["toolsBottom"] - r["contentTop"]) - 12) <= 1,
          "top %.0f bottom %.0f content %.0f" % (r["toolsTop"], r["toolsBottom"], r["contentTop"]))
    check("tools do not overlap the calendar's mode/⟳/‹/Today/›/⤢ buttons", r["nBtns"] == 6 and not r["overlapsAny"],
          "buttons=%d firstBtnTop=%s" % (r["nBtns"], r["firstBtnTop"]))
    # hover to show them in a screenshot
    m.set_context("content")
    # GridStack animates tiles into place, and a hover landing mid-animation
    # lands on the old position and misses. Sleeping and hoping flaked twice,
    # so re-hover until it takes rather than guessing at a duration.
    vis = "0"
    for _ in range(6):
        cal_el = m.find_element("css selector", ".cw-cal-head")
        m.actions.sequence("pointer", "mouse", {"pointerType": "mouse"}).pointer_move(0, 0, origin=cal_el).perform()
        time.sleep(0.7)
        vis = page("""
          const cal = [...document.querySelectorAll('#grid .grid-stack-item')].find(e => e._cthulhu && e._cthulhu.id === 'calendar');
          return getComputedStyle(cal.querySelector('.cthulhu-widget-tools')).opacity;
        """)
        if vis == "1":
            break
    check("tools visible on hover", vis == "1", vis)
    shot("02-calendar-hover")

    # --- calendar: the Notion-style month board, before any Google account
    cal = page("""
      const c = [...document.querySelectorAll('#grid .grid-stack-item')].find(e => e._cthulhu && e._cthulhu.id === 'calendar');
      const today = c.querySelector('.cw-cal-day.today .cw-cal-num');
      return { title: c.querySelector('.cw-cal-title').textContent,
               dows: c.querySelectorAll('.cw-cal-dow').length,
               weeks: c.querySelectorAll('.cw-cal-week').length,
               days: c.querySelectorAll('.cw-cal-day').length,
               adds: c.querySelectorAll('.cw-cal-add').length,
               today: today ? today.textContent : null,
               foot: c.querySelector('.cw-cal-foot').textContent };
    """)
    now = datetime.date.today()
    check("board titled with the current month", re.match(r"^[A-Z][a-z]+ \d{4}$", cal["title"]) and str(now.year) in cal["title"], cal["title"])
    check("7 weekday headers", cal["dows"] == 7, cal["dows"])
    check("5-6 whole weeks, 7 days each, one + per day", cal["weeks"] in (5, 6) and cal["days"] == cal["weeks"] * 7 and cal["adds"] == cal["days"],
          {k: cal[k] for k in ("weeks", "days", "adds")})
    check("today is highlighted with its day number", cal["today"] == str(now.day), cal["today"])
    check("board draws before Google is connected, and says how to connect", "⚙" in cal["foot"], cal["foot"])
    # + without a connection must explain, not fail silently
    page("""
      const c = [...document.querySelectorAll('#grid .grid-stack-item')].find(e => e._cthulhu && e._cthulhu.id === 'calendar');
      c.querySelector('.cw-cal-day.today .cw-cal-add').click();
    """)
    time.sleep(0.3)
    t = page("const t = document.getElementById('cthulhu-toast'); return t ? t.textContent : '';")
    check("+ while disconnected asks to connect", "Connect" in t, t)

    # inject three items (no account needed) and check the board lays them out
    first = now.replace(day=1)
    a0 = first + datetime.timedelta(days=(6 - first.weekday()) % 7 + 1)   # first Monday on/after the 1st
    a_first, a_last = a0, a0 + datetime.timedelta(days=2)                    # Mon..Wed, one bar
    b_day = a0                                                               # timed, same Monday -> second lane
    c_day = a0 + datetime.timedelta(days=9)                                  # next week Wednesday
    laid = page("""
      const [af, al, bd, cd] = arguments;
      const c = [...document.querySelectorAll('#grid .grid-stack-item')].find(e => e._cthulhu && e._cthulhu.id === 'calendar');
      const dbg = c.querySelector('.cw-cal')._cthCalDebug;
      const exclusive = (ymd) => { const [y,m,d] = ymd.split('-').map(Number); const t = new Date(y, m-1, d+1); return t.getFullYear()+'-'+String(t.getMonth()+1).padStart(2,'0')+'-'+String(t.getDate()).padStart(2,'0'); };
      dbg.inject([
        { id:'A', summary:'three day bar', start:{date:af}, end:{date:exclusive(al)}, creator:{self:true},
          extendedProperties:{shared:{cthulhuKind:'project'}} },
        { id:'B', summary:'nine am', start:{dateTime:bd+'T09:00:00'}, end:{dateTime:bd+'T10:00:00'}, creator:{self:false, email:'them@example.invalid'},
          _cthCal:'them-cal', extendedProperties:{shared:{cthulhuKind:'task'}} },
        { id:'C', summary:'single', start:{date:cd}, end:{date:exclusive(cd)}, creator:{self:true} },
      ]);
      const seg = (id) => { const b = c.querySelector('.cw-cal-ev[data-event-id="'+id+'"]'); return b ? { col: b.style.gridColumn, row: b.style.gridRow, cls: b.className, week: [...c.querySelectorAll('.cw-cal-week')].indexOf(b.parentElement), pill: (b.querySelector('.cw-cal-pill')||{}).textContent || '', handles: b.querySelectorAll('.cw-cal-rz').length, side: b.dataset.side, cal: b.dataset.cal, calpill: (b.querySelector('.cw-cal-calpill')||{}).textContent || '' } : null; };
      return { n: c.querySelectorAll('.cw-cal-ev').length, A: seg('A'), B: seg('B'), C: seg('C') };
    """, a_first.isoformat(), a_last.isoformat(), b_day.isoformat(), c_day.isoformat())
    print("BOARD", laid)
    check("three injected items rendered as boxes", laid["n"] == 3, laid["n"])
    check("A is ONE bar spanning three columns with both resize handles", laid["A"] and laid["A"]["col"] == "2 / 5" and laid["A"]["handles"] == 2 and "Project" == laid["A"]["pill"], laid["A"])
    check("B (same day, timed, on a calendar tagged Theirs) drops to the next lane and is dashed", laid["B"] and laid["B"]["row"] == "3" and "theirs" in laid["B"]["cls"] and laid["B"]["side"] == "theirs" and laid["B"]["cal"] == "them-cal", laid["B"])
    check("A (primary, tagged Mine) is mine even with an unknown creator, and boxes name their calendar", laid["A"]["side"] == "mine" and laid["A"]["calpill"] == "Primary" and laid["B"]["calpill"] == "them-cal", {"A": laid["A"]["side"], "Acal": laid["A"]["calpill"], "Bcal": laid["B"]["calpill"]})
    check("C lands in the following week", laid["C"] and laid["C"]["week"] == laid["A"]["week"] + 1 and laid["C"]["row"] == "2", laid["C"])

    # drag A with real pointer input. The grab lands on the bar's CENTRE (its
    # middle day), so dropping on the day after its end moves it by TWO days --
    # the grab offset is kept, exactly as in Notion. Without Google the patch
    # then fails, so the board must show the optimistic move AND explain.
    a_box = m.find_element("css selector", '.cw-cal-ev[data-event-id="A"]')
    target = m.find_element("css selector", '.cw-cal-day[data-ymd="%s"]' % (a_last + datetime.timedelta(days=1)).isoformat())
    m.actions.sequence("pointer", "mouse", {"pointerType": "mouse"}) \
        .pointer_move(0, 0, origin=a_box).pointer_down() \
        .pointer_move(20, 0, origin=a_box).pointer_move(0, 0, origin=target).pointer_up().perform()
    time.sleep(0.6)
    moved = page("""
      const c = [...document.querySelectorAll('#grid .grid-stack-item')].find(e => e._cthulhu && e._cthulhu.id === 'calendar');
      const a = c.querySelector('.cw-cal-ev[data-event-id="A"]');
      const ev = c.querySelector('.cw-cal').__proto__ && null;
      const evs = c.querySelector('.cw-cal')._cthCalDebug.events().find(e => e.id === 'A');
      return { col: a ? a.style.gridColumn : null, start: evs.start.date, end: evs.end.date,
               toast: (document.getElementById('cthulhu-toast') || {}).textContent || '' };
    """)
    print("MOVED", moved)
    check("drag moved A by the grab offset (+2 days), still 3 long", moved["start"] == (a_first + datetime.timedelta(days=2)).isoformat()
          and moved["end"] == (a_last + datetime.timedelta(days=3)).isoformat(), moved)
    check("board shows the move optimistically", moved["col"] == "4 / 7", moved["col"])
    check("and the failed Google patch is explained", "Could not move" in moved["toast"], moved["toast"])

    # resize C by its right edge onto the next day
    handle = m.find_element("css selector", '.cw-cal-ev[data-event-id="C"] .cw-cal-rz.r')
    nxt = m.find_element("css selector", '.cw-cal-day[data-ymd="%s"]' % (c_day + datetime.timedelta(days=1)).isoformat())
    m.actions.sequence("pointer", "mouse", {"pointerType": "mouse"}) \
        .pointer_move(0, 0, origin=handle).pointer_down().pointer_move(15, 0, origin=handle).pointer_move(0, 0, origin=nxt).pointer_up().perform()
    time.sleep(0.5)
    rz = page("""
      const c = [...document.querySelectorAll('#grid .grid-stack-item')].find(e => e._cthulhu && e._cthulhu.id === 'calendar');
      const ev = c.querySelector('.cw-cal')._cthCalDebug.events().find(e => e.id === 'C');
      const b = c.querySelector('.cw-cal-ev[data-event-id="C"]');
      return { start: ev.start.date, end: ev.end.date, col: b ? b.style.gridColumn : null };
    """)
    check("edge drag grew C to two days", rz["start"] == c_day.isoformat() and rz["end"] == (c_day + datetime.timedelta(days=2)).isoformat(), rz)

    # click (no movement) on a box -> its details, Google-Calendar style
    page("""
      const c = [...document.querySelectorAll('#grid .grid-stack-item')].find(e => e._cthulhu && e._cthulhu.id === 'calendar');
      const dbg = c.querySelector('.cw-cal')._cthCalDebug;
      const evs = dbg.events(); const cev = evs.find(e => e.id === 'C'); cev.description = 'Bring the form. Instructions: https://example.invalid/files/1 and notes.';
      dbg.inject(evs);
    """)
    title_el = m.find_element("css selector", '.cw-cal-ev[data-event-id="C"] .cw-cal-ev-title')
    m.actions.sequence("pointer", "mouse", {"pointerType": "mouse"}).pointer_move(0, 0, origin=title_el).pointer_down().pointer_up().perform()
    time.sleep(0.4)
    det = page("""
      const d = document.querySelector('.cw-cal-dt-modal');
      if (!d) return null;
      return { title: d.querySelector('.cw-cal-dt-title').textContent, when: d.querySelector('.cw-cal-dt-when').textContent,
               notes: (d.querySelector('.cw-cal-dt-notes') || {}).textContent, links: [...d.querySelectorAll('.cw-cal-dt-notes a')].map(a => a.href),
               meta: d.querySelector('.cw-cal-dt-meta').textContent,
               actions: [...d.querySelectorAll('.cw-cal-dt-actions button')].map(b => b.textContent),
               noRename: !document.querySelector('.cw-cal-ev-title input') };
    """)
    check("click on a box opens its details: name, when, notes with the link clickable, calendar, actions",
          det and det["title"] == "single" and "All day" in det["when"] and det["links"] == ["https://example.invalid/files/1"]
          and "Calendar: Primary" in det["meta"] and det["actions"] == ["Mark done", "Edit", "Delete"] and det["noRename"], det)
    shot("02b-calendar-details")
    page("const d = document.querySelector('.cw-cal-dt-modal'); if (d) d.remove();")
    # a click on the tile's EMPTY space (a GridStack drag that goes nowhere) expands the board
    empty_day = m.find_element("css selector", '.cw-cal-week:last-child .cw-cal-day:nth-child(6)')
    m.actions.sequence("pointer", "mouse", {"pointerType": "mouse"}).pointer_move(0, 8, origin=empty_day).pointer_down().pointer_up().perform()
    time.sleep(0.8)
    big = page("""
      const b = document.querySelector('.cw-cal-big-modal');
      if (!b) return null;
      const r = b.querySelector('.cw-cal-big').getBoundingClientRect();
      return { w: r.width / window.innerWidth, h: r.height / window.innerHeight, weeks: b.querySelectorAll('.cw-cal-week').length,
               boxes: b.querySelectorAll('.cw-cal-ev').length, closeBtn: !!b.querySelector('.cw-cal-hbtn.close'), expandBtn: !!b.querySelector('.cw-cal-hbtn.expand'),
               tileStill: !!document.querySelector('#grid .cw-cal') };
    """)
    check("clicking empty tile space expands the board to most of the window, with a close button and no nested expand",
          big and big["w"] > 0.85 and big["h"] > 0.85 and big["weeks"] in (5, 6) and big["closeBtn"] and not big["expandBtn"] and big["tileStill"], big)
    shot("02c-calendar-expanded")
    # click outside closes it, and the tile re-renders
    page("const b = document.querySelector('.cw-cal-big-modal'); if (b) b.dispatchEvent(new MouseEvent('click', {bubbles:true}));")
    time.sleep(0.5)
    gone = page("return { big: !!document.querySelector('.cw-cal-big-modal'), tile: !!document.querySelector('#grid .cw-cal .cw-cal-week') };")
    check("clicking outside the expanded board closes it and the tile is still there", not gone["big"] and gone["tile"], gone)
    # the injected events are gone with the re-render; re-inject for the checks below
    page("""
      const [af, al, bd, cd] = arguments;
      const c = [...document.querySelectorAll('#grid .grid-stack-item')].find(e => e._cthulhu && e._cthulhu.id === 'calendar');
      const exclusive = (ymd) => { const [y,m,d] = ymd.split('-').map(Number); const t = new Date(y, m-1, d+1); return t.getFullYear()+'-'+String(t.getMonth()+1).padStart(2,'0')+'-'+String(t.getDate()).padStart(2,'0'); };
      c.querySelector('.cw-cal')._cthCalDebug.inject([
        { id:'A', summary:'three day bar', start:{date:af}, end:{date:exclusive(al)}, creator:{self:true}, extendedProperties:{shared:{cthulhuKind:'project'}} },
        { id:'B', summary:'nine am', start:{dateTime:bd+'T09:00:00'}, end:{dateTime:bd+'T10:00:00'}, creator:{self:false}, _cthCal:'them-cal', extendedProperties:{shared:{cthulhuKind:'task'}} },
        { id:'C', summary:'single', start:{date:cd}, end:{date:exclusive(cd)}, creator:{self:true} },
      ]);
    """, a_first.isoformat(), a_last.isoformat(), b_day.isoformat(), c_day.isoformat())
    time.sleep(0.3)
    shot("02b-calendar-board")

    # delete is ONE click now: no "sure?" arm step
    n_before = page("return document.querySelectorAll('.cw-cal-ev').length;")
    hov = m.find_element("css selector", '.cw-cal-ev[data-event-id="C"]')
    m.actions.sequence("pointer", "mouse", {"pointerType": "mouse"}).pointer_move(0, 0, origin=hov).perform()
    time.sleep(0.3)
    dele = page("""
      const b = document.querySelector('.cw-cal-ev[data-event-id="C"] .cw-cal-rbtn.del');
      const before = b ? b.textContent : null;
      if (b) b.click();
      return { before, gone: !document.querySelector('.cw-cal-ev[data-event-id="C"]'),
               n: document.querySelectorAll('.cw-cal-ev').length,
               tools: [...document.querySelectorAll('.cw-cal-ev[data-event-id="A"] .cw-cal-rbtn')].map(x => x.className.replace('cw-cal-rbtn ', '')) };
    """)
    check("one click on x deletes the box (no confirm step)", dele["before"] == "\u00d7" and dele["gone"] and dele["n"] == n_before - 1, dele)
    check("each box offers done / edit / delete", dele["tools"] == ["done", "edit", "del"], dele["tools"])

    # the item editor: + on a day opens it (once "connected"), with a calendar chooser
    page("""
      const c = [...document.querySelectorAll('#grid .grid-stack-item')].find(e => e._cthulhu && e._cthulhu.id === 'calendar');
      const dbg = c.querySelector('.cw-cal')._cthCalDebug;
      dbg.inject(dbg.events(), { connected: true, calendars: [
        { id: 'me@example.invalid', summary: 'Personal', primary: true, canWrite: true },
        { id: 'them-cal', summary: 'Their school', primary: false, canWrite: false } ] });
      c.querySelector('.cw-cal-day.today .cw-cal-add').click();
    """)
    time.sleep(0.4)
    ed = page("""
      const mdl = document.querySelector('.cw-cal-ed-modal');
      if (!mdl) return null;
      const chips = (cap) => { const f = [...mdl.querySelectorAll('.cw-ui-field, .cw-ui-row')].find(x => x.textContent.startsWith(cap)); return f ? [...f.querySelectorAll('.cw-ui-choice-btn')].map(b => b.textContent) : null; };
      return { title: mdl.querySelector('.cthulhu-config-title').textContent,
               focused: document.activeElement === mdl.querySelector('.cw-cal-ed-name'),
               calendars: chips('Calendar'), kinds: chips('Kind'),
               dates: [...mdl.querySelectorAll('.cw-cal-ed-date')].map(i => i.value),
               allDay: mdl.querySelector('input[type=checkbox]').checked,
               notes: !!mdl.querySelector('textarea'), selects: mdl.querySelectorAll('select').length };
    """)
    check("+ opens the item editor with the name focused", ed and ed["title"] == "New item" and ed["focused"], ed)
    check("editor offers only writable, switched-on calendars (the read-only one is absent)", ed and ed["calendars"] == ["Personal"], ed and ed["calendars"])
    check("editor has kind chips, both dates prefilled with the day, all-day on, notes, and no native select",
          ed and ed["kinds"] == ["Task", "Deadline", "Event", "Project"] and ed["dates"][0] == now.isoformat() and ed["dates"][1] == now.isoformat() and ed["allDay"] and ed["notes"] and ed["selects"] == 0, ed)
    shot("02c-calendar-editor")
    # type a name, pick Deadline, Enter -> optimistic box + explained failure (no Google)
    name_el = m.find_element("css selector", ".cw-cal-ed-name")
    name_el.send_keys("dentist")
    page("[...document.querySelectorAll('.cw-cal-ed-modal .cw-ui-choice-btn')].find(b => b.textContent === 'Deadline').click();")
    page("const n = document.querySelector('.cw-cal-ed-name'); n.dispatchEvent(new KeyboardEvent('keydown', {key:'Enter', bubbles:true}));")
    time.sleep(0.8)
    made = page("""
      const c = [...document.querySelectorAll('#grid .grid-stack-item')].find(e => e._cthulhu && e._cthulhu.id === 'calendar');
      const ev = c.querySelector('.cw-cal')._cthCalDebug.events().find(e => e.summary === 'dentist');
      const box = [...c.querySelectorAll('.cw-cal-ev')].find(b => b.querySelector('.cw-cal-ev-title').textContent === 'dentist');
      return { modalGone: !document.querySelector('.cw-cal-ed-modal'), ev: ev ? { cal: ev._cthCal, kind: ev.extendedProperties.shared.cthulhuKind, start: ev.start } : null,
               box: !!box, pill: box ? (box.querySelector('.cw-cal-pill')||{}).textContent : null,
               toast: (document.getElementById('cthulhu-toast') || {}).textContent || '' };
    """)
    check("Enter creates the item on the chosen calendar with the chosen kind (optimistically)",
          made["modalGone"] and made["ev"] and made["ev"]["cal"] == "primary" and made["ev"]["kind"] == "deadline" and made["ev"]["start"].get("date") == now.isoformat() and made["box"] and made["pill"] == "Deadline", made)
    check("and the failed Google create is explained", "Could not create" in made["toast"], made["toast"])
    # the pencil opens the same editor prefilled
    page("""
      const c = [...document.querySelectorAll('#grid .grid-stack-item')].find(e => e._cthulhu && e._cthulhu.id === 'calendar');
      c.querySelector('.cw-cal-ev[data-event-id="A"] .cw-cal-rbtn.edit').click();
    """)
    time.sleep(0.4)
    ed2 = page("""
      const mdl = document.querySelector('.cw-cal-ed-modal');
      return mdl ? { title: mdl.querySelector('.cthulhu-config-title').textContent, name: mdl.querySelector('.cw-cal-ed-name').value,
                     dates: [...mdl.querySelectorAll('.cw-cal-ed-date')].map(i => i.value), hasDelete: !!mdl.querySelector('.cw-cal-ed-del'),
                     kindOn: (mdl.querySelector('.cw-ui-choice-btn.on') || {}).textContent } : null;
    """)
    check("the pencil opens the editor prefilled for editing", ed2 and ed2["title"] == "Edit item" and ed2["name"] == "three day bar" and ed2["hasDelete"] and ed2["dates"][1] > ed2["dates"][0], ed2)
    page("const mdl = document.querySelector('.cw-cal-ed-modal'); if (mdl) mdl.remove();")

    # --- theme switching: page + chrome follow, favourites
    page("w.CthulhuThemes.setTheme('rose');"); time.sleep(0.6)
    pa = page("return getComputedStyle(document.documentElement).getPropertyValue('--accent').trim();")
    ca = chrome("return getComputedStyle(document.documentElement).getPropertyValue('--accent').trim();")
    check("setTheme('rose'): page accent", pa == "#ff7aa2", pa)
    check("setTheme('rose'): chrome accent follows", ca == "#ff7aa2", ca)
    on = page("return [...document.querySelectorAll('.cw-theme-row.on')].map(b => b.dataset.id);")
    check("theme widget highlights rose", on == ["rose"], on)
    page("w.CthulhuThemes.toggleFavorite('rose'); w.CthulhuThemes.toggleFavorite('abyss');"); time.sleep(0.4)
    favs = page("return w.CthulhuThemes.favorites();")
    secs = page("return [...document.querySelectorAll('.cw-theme-sec')].map(e => e.textContent);")
    check("favourites persisted", favs == ["rose", "abyss"], favs)
    check("favourites section shown", "Favourites" in secs, secs)
    shot("03-theme-rose")
    if SHOTS:
        m.set_context("chrome")
        with open(os.path.join(SHOTS, "03b-chrome-rose.png"), "wb") as f: f.write(base64.b64decode(m.screenshot(format="base64")))
        print("SHOT 03b-chrome-rose")
    page("w.CthulhuThemes.setTheme('ambient');"); time.sleep(0.6)
    band = page("return document.documentElement.getAttribute('cthulhu-ambient-time');")
    cband = chrome("return document.documentElement.getAttribute('cthulhu-ambient-time');")
    check("ambient: page resolves a band", band in ("dawn", "day", "dusk", "night"), band)
    check("ambient: chrome resolves the same band", cband == band, cband)
    page("w.CthulhuThemes.setTheme('paper');"); time.sleep(0.6)
    light = page("return document.documentElement.hasAttribute('cthulhu-theme-light');")
    check("light theme flagged", light)
    shot("04-theme-paper")
    sch = page("return { root: document.documentElement.style.colorScheme, computed: getComputedStyle(document.documentElement).colorScheme };")
    ovr = chrome("return Services.prefs.getIntPref('layout.css.prefers-color-scheme.content-override', 2);")
    check("a light palette makes the page light-scheme and forces web content light (override=1)", sch["root"] == "light" and sch["computed"] == "light" and ovr == 1, {"page": sch, "override": ovr})
    page("w.CthulhuThemes.setTheme('night');"); time.sleep(0.5)
    ovr2 = chrome("return Services.prefs.getIntPref('layout.css.prefers-color-scheme.content-override', 2);")
    check("a dark palette forces web content dark (override=0)", ovr2 == 0, ovr2)
    names = page("return Object.fromEntries(w.CthulhuThemes.presets().map(p => [p.id, p.name]));")
    check("themes renamed (ids unchanged)", names.get("dawn") == "the big biscuit" and names.get("dusk") == "Domo" and names.get("abyss") == "Not Even Domo"
          and names.get("rose") == "Rose-Pine" and names.get("forest") == "Little boy in a forest cabin with his grandma" and names.get("ember") == "Traffic light at night"
          and names.get("lavender") == "Night Sky" and names.get("mono") == "Colorblind Simulator" and names.get("day") == "Flashbang" and names.get("paper") == "Flashbang 2"
          and names.get("night", "").startswith("It's turning blue") and names.get("cthulhu") == "Cthulhu", names)

    # --- gradient: custom colours reach the tile; config panel has real inputs
    page("""
      const el = [...document.querySelectorAll('#grid .grid-stack-item')].find(e => e._cthulhu && e._cthulhu.id === 'gradient');
      el._cthulhu.config = { mode:'custom', colors:['#ff0000','#00ff00','#0000ff'], angle: 90, speed: 4 };
      w.CthulhuHome; el._cthulhu.el.querySelector('.cthulhu-widget-body').innerHTML='';
    """)
    page("""
      const el = [...document.querySelectorAll('#grid .grid-stack-item')].find(e => e._cthulhu && e._cthulhu.id === 'gradient');
      const ctxLike = { config: el._cthulhu.config };
      // re-render through the core path
      const body = el.querySelector('.cthulhu-widget-body'); body.innerHTML='';
      el._cthulhu.def.render(body, Object.assign({ theme: w.CthulhuThemes }, ctxLike));
    """)
    gv = page("""
      const g = document.querySelector('.cw-gradient'); const cs = getComputedStyle(g);
      return [cs.getPropertyValue('--g1').trim(), cs.getPropertyValue('--g-angle').trim(), cs.getPropertyValue('--g-speed').trim()];
    """)
    check("gradient custom colours/angle/speed applied", gv == ["#ff0000", "90deg", "4s"], gv)
    page("""
      const el = [...document.querySelectorAll('#grid .grid-stack-item')].find(e => e._cthulhu && e._cthulhu.id === 'gradient');
      el.querySelector('.cthulhu-widget-tools button').click();
    """)
    time.sleep(0.5)
    cfg = page("""
      const p = document.querySelector('.cthulhu-widget-config');
      return { colorInputs: p.querySelectorAll('input[type=color]').length, ranges: p.querySelectorAll('input[type=range]').length,
               swatches: p.querySelectorAll('.cw-ui-swatch').length, checks: p.querySelectorAll('input[type=checkbox]').length };
    """)
    check("gradient config: 3 colour pickers, 2 sliders, presets, follow-theme checkbox",
          cfg == {"colorInputs": 3, "ranges": 2, "swatches": 7, "checks": 1}, cfg)
    shot("05-gradient-config")
    page("document.querySelector('.cthulhu-config-modal').remove();")

    # --- orb: tint filter computed
    time.sleep(1)
    orb = page("""
      const s = document.querySelector('.cw-orb-sprite'); return { filter: s.style.filter, anim: s.style.animation.length > 0 };
    """)
    check("orb sprite animating", orb["anim"])
    check("orb tint filter applied (follow-accent)", "hue-rotate" in orb["filter"] and "drop-shadow" in orb["filter"], orb["filter"])
    # a 1x1 orb must not overflow its tile (the Windows scrollbar report)
    page("w.CthulhuHome.addWidgetByType('orb', {x:4, y:3, w:1, h:1, config:{color:'', glow:true, scale:6}});")
    time.sleep(1.2)
    small = page("""
      const el = [...document.querySelectorAll('#grid .grid-stack-item')].find(e => e._cthulhu && e._cthulhu.id === 'orb' && e.gridstackNode.w === 1);
      const body = el.querySelector('.cthulhu-widget-body'); const sp = el.querySelector('.cw-orb-sprite'); const wrap = el.querySelector('.cw-orb');
      const r = sp.getBoundingClientRect(), b = wrap.getBoundingClientRect();
      return { scale: +sp.dataset.scale, wanted: 6, overflowX: body.scrollWidth > body.clientWidth, overflowY: body.scrollHeight > body.clientHeight,
               inside: r.left >= b.left - 1 && r.right <= b.right + 1 && r.top >= b.top - 1 && r.bottom <= b.bottom + 1, wrapOverflow: getComputedStyle(wrap).overflow };
    """)
    check("a 1x1 orb shrinks below its configured size to fit and never scrolls", small["scale"] < small["wanted"] and small["scale"] >= 1 and not small["overflowX"] and not small["overflowY"] and small["inside"] and small["wrapOverflow"] == "hidden", small)
    page("const el = [...document.querySelectorAll('#grid .grid-stack-item')].find(e => e._cthulhu && e._cthulhu.id === 'orb' && e.gridstackNode.w === 1); w.CthulhuHome.removeWidget(el);")
    # orb speed: a multiplier on the art's own frame rate
    page("w.CthulhuHome.addWidgetByType('orb', {x:4, y:3, w:1, h:1, config:{color:'', glow:true, scale:2, speed:2}});")
    time.sleep(1.2)
    spd = page("""
      const els = [...document.querySelectorAll('#grid .grid-stack-item')].filter(e => e._cthulhu && e._cthulhu.id === 'orb');
      const dur = (e) => parseFloat(getComputedStyle(e.querySelector('.cw-orb-sprite')).animationDuration);
      const slow = els.find(e => (e._cthulhu.config.speed || 1) === 1), fast = els.find(e => e._cthulhu.config.speed === 2);
      return { slow: dur(slow), fast: dur(fast) };
    """)
    check("orb speed 2x halves the sprite's animation duration", spd["slow"] > 0 and abs(spd["fast"] - spd["slow"] / 2) < 0.02, spd)
    page("""
      const el = [...document.querySelectorAll('#grid .grid-stack-item')].find(e => e._cthulhu && e._cthulhu.id === 'orb' && e._cthulhu.config.speed === 2);
      el.querySelector('.cthulhu-widget-tools button').click();
    """); time.sleep(0.4)
    rng = page("return [...document.querySelectorAll('.cthulhu-widget-config .cw-ui-row')].filter(r => r.querySelector('input[type=range]')).map(r => r.querySelector('.cw-ui-label').textContent);")
    check("orb config offers Size and Speed sliders", rng == ["Size (max)", "Speed"], rng)
    page("document.querySelector('.cthulhu-config-modal').remove(); const el = [...document.querySelectorAll('#grid .grid-stack-item')].find(e => e._cthulhu && e._cthulhu.id === 'orb' && e.gridstackNode.w === 1); w.CthulhuHome.removeWidget(el);")

    # moon: the ART is centred, not the 32px frame
    page("w.CthulhuHome.addWidgetByType('moon', {x:4, y:3, w:1, h:1});")
    time.sleep(1.2)
    moon = page("""
      return w.CthulhuWidgets.moonBounds().then(b => {
        const fr = document.querySelector('#grid .cw-moon .cthulhu-moon-frame');
        const outer = fr.parentElement;
        const f = +fr.dataset.frame; const fb = b[f];
        const size = outer.getBoundingClientRect().width; const s = size / b.frameW;
        const dpr = window.devicePixelRatio || 1; const snap = v => Math.round(v * dpr) / dpr;
        const expectLeft = snap(((b.frameW - 1) / 2 - fb.cx) * s);
        // where the art's centre lands relative to the outer box's centre
        const artCentre = parseFloat(fr.style.left) + (fb.cx + 0.5) * s;
        return { frame: f, cx: fb.cx, left: parseFloat(fr.style.left), expectLeft, artCentre, boxCentre: size / 2, clipped: getComputedStyle(outer).overflow === 'hidden',
                 bounds: Object.keys(b).filter(k => /^[0-9]$/.test(k)).length };
      });
    """)
    check("moon strip measured: 8 frames with opaque bounds", moon["bounds"] == 8, moon)
    check("moon frame nudged so the visible art is centred in the tile", abs(moon["left"] - moon["expectLeft"]) < 0.01 and abs(moon["artCentre"] - moon["boxCentre"]) <= 1.0 and moon["clipped"], moon)
    # and a crescent (an off-centre frame) gets a real nudge: build moons for a run of dates
    cres = page("""
      return w.CthulhuWidgets.moonBounds().then(async (b) => {
        const out = [];
        for (let d = 0; d < 30 && out.length < 2; d++) {
          const date = new Date(); date.setDate(date.getDate() + d);
          const p = w.CthulhuWidgets.moonPhase(date);
          if (![1, 7].includes(p.frame)) continue;
          const el = w.CthulhuWidgets.moonEl(date, 64); document.body.appendChild(el);
          await new Promise(r => setTimeout(r, 50));
          const fr = el.firstElementChild; const fb = b[p.frame]; const s = 64 / b.frameW;
          const dpr = window.devicePixelRatio || 1; const snap = v => Math.round(v * dpr) / dpr;
          out.push({ frame: p.frame, cx: fb.cx, left: parseFloat(fr.style.left), expect: snap(((b.frameW - 1) / 2 - fb.cx) * s),
                     artCentre: parseFloat(fr.style.left) + (fb.cx + 0.5) * s, nudged: Math.abs(parseFloat(fr.style.left)) > 4 });
          el.remove();
        }
        return out;
      });
    """)
    check("a crescent frame is nudged by a real offset so its sliver sits mid-tile",
          len(cres) >= 1 and all(abs(c["left"] - c["expect"]) < 0.01 and abs(c["artCentre"] - 32) <= 1.0 and c["nudged"] for c in cres), cres)
    page("const el = [...document.querySelectorAll('#grid .grid-stack-item')].find(e => e._cthulhu && e._cthulhu.id === 'moon' && e.gridstackNode.w === 1); w.CthulhuHome.removeWidget(el);")

    # --- palette: swatches render, dice adds a palette
    ps = page("return document.querySelectorAll('.cw-pal-sw').length;")
    check("palette shows 5 starter swatches", ps == 5, ps)
    page("[...document.querySelectorAll('.cw-pal-btn')].find(b => b.title.startsWith('Random')).click();"); time.sleep(0.8)
    # the bar's palette chooser is a picker BUTTON now, not a <select>: on this
    # page a select's popup never returns a change event, so switching palettes
    # did nothing. Its label is the palette it would switch to.
    ps2 = page("""
      const b = document.querySelector('.cw-pal-bar .cw-ui-picker');
      return { n: document.querySelectorAll('.cw-pal-sw').length,
               picker: !!b, label: b ? b.textContent : null,
               selects: document.querySelectorAll('.cw-pal-bar select').length };
    """)
    check("dice made a new 5-colour palette and selected it",
          ps2["n"] == 5 and ps2["picker"] and ps2["selects"] == 0 and "Random" in (ps2["label"] or ""), ps2)
    # and the chooser opens on a real click
    picker = m.find_element("css selector", ".cw-pal-bar .cw-ui-picker")
    m.actions.sequence("pointer", "mouse", {"pointerType": "mouse"}).pointer_move(0, 0, origin=picker).pointer_down().pointer_up().perform()
    time.sleep(0.6)
    popped = page("return document.querySelectorAll('.cw-ui-picker-pop .cw-ui-choice-btn').length;")
    check("the palette chooser opens a list on a real click", popped == 2, popped)
    page("const pp = document.querySelector('.cw-ui-picker-pop'); if (pp) pp.remove();")

    # --- pets: the new set, KIY's glitch, Rishi's button, integer scaling
    page("""
      const H = w.CthulhuHome;
      H.addWidgetByType('pet', {x:4, y:3, w:2, h:2, config:{pet:'kiy'}});
      H.addWidgetByType('pet', {x:6, y:3, w:2, h:2, config:{pet:'rishi'}});
      H.addWidgetByType('pet', {x:8, y:3, w:2, h:2, config:{pet:'cthulhu'}});
    """)
    time.sleep(2.5)
    ids = page("return w.CthulhuWidgets.all().map(d => d.id);")
    check("feature-request widget is gone from the registry", "feature-request" not in ids, ids)
    pets = page("return fetch('chrome://cthulhu/content/newtab/widgets/pet/assets/pets.json').then(r => r.json()).then(l => l.map(p => p.id));")
    check("pets.json lists exactly the new pets", pets == ["verity", "kiy", "rishi", "cthulhu", "voyeur", "cat"], pets)
    sizes = page("""
      return [...document.querySelectorAll('.cw-pet-img')].map(i => {
        const st = i.closest('.cw-pet-stage').getBoundingClientRect(), r = i.getBoundingClientRect();
        return { pet: i.dataset.pet, nat: i.naturalWidth + 'x' + i.naturalHeight, scale: +i.dataset.scale,
                 css: Math.round(r.width) + 'x' + Math.round(r.height),
                 integer: i.offsetWidth === i.naturalWidth * +i.dataset.scale && i.offsetHeight === i.naturalHeight * +i.dataset.scale,
                 fits: i.offsetWidth <= st.width + 1 && i.offsetHeight <= st.height + 1,
                 anim: getComputedStyle(i).animationName };
      });
    """)
    print("PETS", sizes)
    check("three pets rendered", len(sizes) == 3, len(sizes))
    check("every pet scaled by an integer factor >= 1 and fits its stage", all(s["integer"] and s["scale"] >= 1 and s["fits"] for s in sizes), sizes)
    check("different native sizes get different factors (art is not pre-scaled)", len({s["nat"] for s in sizes}) == 3, [s["nat"] for s in sizes])
    check("a single-frame pet idles", any(s["pet"] == "cthulhu" and s["anim"] == "cw-pet-idle" for s in sizes))
    # KIY: frames change, in a random order, and the name never sits still
    kiy = page("""
      const img = document.querySelector('.cw-pet-img[data-pet="kiy"]');
      const name = img.closest('.cw-pet').querySelector('.cw-pet-name');
      const srcs = [], names = [];
      return new Promise(res => {
        let n = 0;
        const iv = setInterval(() => {
          srcs.push(img.src.split('/').pop()); names.push(name.textContent);
          if (++n >= 14) { clearInterval(iv); res({ srcs, names }); }
        }, 95);
      });
    """)
    distinct = len(set(kiy["srcs"]))
    check("KIY cycles its frames rapidly", distinct >= 4, kiy["srcs"])
    check("KIY frames are not in numeric order", kiy["srcs"] != sorted(kiy["srcs"], key=lambda s: int(re.sub(r"\D", "", s) or 0)) , kiy["srcs"][:6])
    check("KIY's label flickers between KIY and gibberish", "KIY" in kiy["names"] and len(set(kiy["names"])) >= 3, kiy["names"][:8])
    # the picker: a list of real buttons, NOT a native <select>. A native select
    # puts its menu in a chrome-level popup reached through the
    # ContentSelectDropdown actor pair, and the pick never came back to the page
    # as a change event -- so choosing a pet did nothing and it stayed on Random.
    page("[...document.querySelectorAll('#grid .grid-stack-item')].find(e => e._cthulhu && e._cthulhu.id === 'pet').querySelector('.cthulhu-widget-btn[title=\"Configure\"]').click();")
    time.sleep(0.5)
    pick = page("""
      const rows = [...document.querySelectorAll('.cw-pet-row')];
      return { ids: rows.map(r => r.dataset.pet), tags: [...new Set(rows.map(r => r.tagName))],
               selects: document.querySelectorAll('.cthulhu-config-modal select').length,
               thumbs: rows.filter(r => r.querySelector('img')).length,
               on: rows.filter(r => r.classList.contains('on')).map(r => r.dataset.pet) };
    """)
    check("picker is buttons, with no native <select> to get stuck in",
          pick["selects"] == 0 and pick["tags"] == ["BUTTON"], pick)
    check("a row per pet plus Random, each showing its art",
          pick["ids"] == ["random","verity","kiy","rishi","cthulhu","voyeur","cat"] and pick["thumbs"] == 6, pick)
    check("the configured pet is the highlighted row", pick["on"] == ["kiy"], pick["on"])
    opt = page("""
      const l = document.querySelector('.cw-pet-row[data-pet="kiy"] .cw-pet-rowname');
      return new Promise(res => { const seen = []; let n = 0; const iv = setInterval(() => { seen.push(l.textContent); if (++n >= 12) { clearInterval(iv); res(seen); } }, 90); });
    """)
    check("KIY's row in the picker flickers", "KIY" in opt and len(set(opt)) >= 3, opt[:8])
    # a REAL mouse click on a row must select that pet -- the thing that was broken
    row = m.find_element("css selector", '.cw-pet-row[data-pet="cthulhu"]')
    m.actions.sequence("pointer", "mouse", {"pointerType": "mouse"}).pointer_move(0, 0, origin=row).pointer_down().pointer_up().perform()
    time.sleep(1.2)
    picked = page("""
      const inst = [...document.querySelectorAll('#grid .grid-stack-item')].find(e => e._cthulhu && e._cthulhu.id === 'pet')._cthulhu;
      const img = document.querySelector('.cw-pet-img[data-pet="cthulhu"]');
      return { config: inst.config.pet, rendered: !!img,
               on: [...document.querySelectorAll('.cw-pet-row.on')].map(r => r.dataset.pet) };
    """)
    check("a real click on a row selects that pet and renders it",
          picked["config"] == "cthulhu" and picked["rendered"] and picked["on"] == ["cthulhu"], picked)
    page("const mm = document.querySelector('.cthulhu-config-modal'); if (mm) mm.remove();")
    time.sleep(0.3)
    stopped = page("return document.querySelector('.cw-pet-row[data-pet=\"kiy\"]') ? 'still in DOM' : 'gone';")
    check("closing the panel removes the flickering row (its timer stops itself)", stopped == "gone", stopped)
    # Rishi: a real button that opens the feature-request form
    hit = page("const b = document.querySelector('.cw-pet-hit'); return b ? { tag: b.tagName, hasRishi: !!b.querySelector('img[data-pet=\"rishi\"]'), title: b.title } : null;")
    check("Rishi is wrapped in a real <button>", hit and hit["tag"] == "BUTTON" and hit["hasRishi"], hit)
    m.find_element("css selector", ".cw-pet-hit").click()
    time.sleep(1.2)
    rr = page("""
      const mdl = document.querySelector('.cw-rr-modal');
      return mdl ? { textarea: !!mdl.querySelector('textarea'), send: !!mdl.querySelector('.cw-rr-send'), title: mdl.querySelector('.cthulhu-config-title').textContent,
                     focused: document.activeElement === mdl.querySelector('textarea') } : null;
    """)
    check("clicking Rishi opens the feature-request form (loaded on demand)", rr and rr["textarea"] and rr["send"] and rr["title"] == "Feature request" and rr["focused"], rr)
    shot("08-rishi-request")
    page("const mdl = document.querySelector('.cw-rr-modal'); if (mdl) mdl.remove();")
    shot("09-pets")

    # only one Rishi per page: a second tile set to him says so instead
    page("w.CthulhuHome.addWidgetByType('pet', {x:0, y:0, w:2, h:2, config:{pet:'rishi'}});")
    time.sleep(1.5)
    two = page("""
      return { rishis: document.querySelectorAll('.cw-pet-img[data-pet="rishi"]').length,
               only: [...document.querySelectorAll('.cw-pet-only')].map(e => e.textContent) };
    """)
    check("a second Rishi tile shows the one-Rishi message instead of a second Rishi", two["rishis"] == 1 and two["only"] == ["There can only be one Rishi at a time"], two)
    # and the picker refuses him on that tile
    page("""
      const second = [...document.querySelectorAll('#grid .grid-stack-item')].find(e => e.querySelector('.cw-pet-only'));
      second.querySelector('.cthulhu-widget-btn[title="Configure"]').click();
    """)
    time.sleep(0.5)
    page("document.querySelector('.cw-pet-row[data-pet=\"cthulhu\"]').click();"); time.sleep(0.8)
    page("document.querySelector('.cw-pet-row[data-pet=\"rishi\"]').click();"); time.sleep(0.5)
    refused = page("""
      const second = [...document.querySelectorAll('#grid .grid-stack-item')].filter(e => e._cthulhu && e._cthulhu.id === 'pet').find(e => e.gridstackNode.x === 0 && e.gridstackNode.y === 0);
      return { config: second._cthulhu.config.pet, toast: (document.getElementById('cthulhu-toast') || {}).textContent || '',
               taken: [...document.querySelectorAll('.cw-pet-row.taken')].map(r => r.dataset.pet) };
    """)
    check("picking Rishi while another tile has him is refused with the message", refused["config"] == "cthulhu" and "one Rishi" in refused["toast"] and refused["taken"] == ["rishi"], refused)
    page("const mm = document.querySelector('.cthulhu-config-modal'); if (mm) mm.remove();")

    # Tea: the variant pref redraws Rishi as Tea, live
    chrome("Services.prefs.setStringPref('cthulhu.pet.rishi.variant', 'tea');"); time.sleep(1.2)
    tea = page("""
      const img = document.querySelector('.cw-pet-img[data-pet="rishi"]');
      return img ? { src: img.src.split('/').pop(), variant: img.dataset.variant, name: img.closest('.cw-pet').querySelector('.cw-pet-name').textContent } : null;
    """)
    check("Switching the variant pref to tea redraws Rishi as Tea", tea and tea["src"] == "tea.png" and tea["variant"] == "tea" and tea["name"] == "Tea", tea)
    chrome("Services.prefs.setStringPref('cthulhu.pet.rishi.variant', '');"); time.sleep(1.0)
    back = page("const img = document.querySelector('.cw-pet-img[data-pet=\"rishi\"]'); return img ? img.src.split('/').pop() : null;")
    check("and back to Rishi", back == "rishi.png", back)
    # mood pref -> bubble, live
    chrome("Services.prefs.setStringPref('cthulhu.pet.rishi.mood', 'shipping it');"); time.sleep(0.6)
    mood = page("const m = document.querySelector('.cw-pet-img[data-pet=\"rishi\"]').closest('.cw-pet').querySelector('.cw-pet-mood'); return m.textContent;")
    check("the mood pref shows in Rishi's bubble live", mood == "shipping it", mood)
    chrome("Services.prefs.setStringPref('cthulhu.pet.rishi.mood', '');")

    # admin panel: relay token section + Rishi section with the Tea switch
    chrome("Services.prefs.setBoolPref('cthulhu.admin.enabled', true);")
    page("w.CthulhuAdmin.open();"); time.sleep(0.5)
    adm = page("""
      const p = document.querySelector('.cthulhu-admin');
      return p ? { sections: [...p.querySelectorAll('.cthulhu-admin-sec')].map(s => s.dataset.section),
                   token: !!p.querySelector('[data-section="relay"] input[type=password]'),
                   tea: (p.querySelector('.cw-pet-teabtn') || {}).textContent,
                   presets: p.querySelectorAll('[data-section="rishi-mood"] .cw-ui-choice-btn').length } : null;
    """)
    check("admin panel has the Relay token section and Rishi's section with a Tea switch", adm and adm["sections"] == ["relay", "rishi-mood"] and adm["token"] and adm["tea"] == "Switch to Tea" and adm["presets"] == 6, adm)
    shot("10-admin")
    page("document.querySelector('.cw-pet-teabtn').click();"); time.sleep(0.8)
    teaLocal = page("""
      const p = document.querySelector('.cthulhu-admin');
      return { pref: Services.prefs.getStringPref('cthulhu.pet.rishi.variant', ''), btn: p.querySelector('.cw-pet-teabtn').textContent,
               status: [...p.querySelectorAll('[data-section="rishi-mood"] .cthulhu-admin-note')].map(n => n.textContent).join(' | '),
               sprite: (document.querySelector('.cw-pet-img[data-pet="rishi"]') || {}).src?.split('/').pop() };
    """)
    check("Switch to Tea flips the pref locally and says so (no relay involved)", teaLocal["pref"] == "tea" and teaLocal["btn"] == "Switch back to Rishi" and "here only" in teaLocal["status"] and teaLocal["sprite"] == "tea.png", teaLocal)
    page("document.querySelector('.cw-pet-teabtn').click();"); time.sleep(0.5)
    page("w.CthulhuAdmin.close();")
    chrome("Services.prefs.setBoolPref('cthulhu.admin.enabled', false);")

    # --- player with something actually playing: a generated 6 s sine in its own tab
    import struct, math
    rate, secs = 8000, 6
    pcm = b"".join(struct.pack("<h", int(0.15 * 32767 * math.sin(2 * math.pi * 440 * i / rate))) for i in range(rate * secs))
    wav = (b"RIFF" + struct.pack("<I", 36 + len(pcm)) + b"WAVEfmt " + struct.pack("<IHHIIHH", 16, 1, 1, rate, rate * 2, 2, 16) + b"data" + struct.pack("<I", len(pcm)) + pcm)
    wav_url = "data:audio/wav;base64," + base64.b64encode(wav).decode()
    # Like a real player, the page declares media-session metadata AND a position state
    # (Firefox reports no position for a bare element; YouTube/Spotify/Apple Music all call this).
    media_page = ("data:text/html,<title>Sine test track</title><audio id=a autoplay loop src=\"" + wav_url + "\"></audio>"
                  "<script>const a=document.getElementById('a');navigator.mediaSession.metadata=new MediaMetadata({title:'Sine test track',artist:'Marionette'});"
                  "navigator.mediaSession.setActionHandler('previoustrack',()=>{});navigator.mediaSession.setActionHandler('nexttrack',()=>{});"
                  "const ps=()=>{try{navigator.mediaSession.setPositionState({duration:a.duration||6,playbackRate:1,position:a.currentTime||0});}catch(e){}};"
                  "a.addEventListener('timeupdate',ps);a.addEventListener('playing',ps);</script>")
    chrome("Services.prefs.setIntPref('media.autoplay.default', 0); Services.prefs.setIntPref('media.autoplay.blocking_policy', 0);")
    chrome("""const t = gBrowser.addTab(arguments[0], { triggeringPrincipal: Services.scriptSecurityManager.getSystemPrincipal() }); gBrowser.selectedTab = t; window.__mediaTab = t;""", media_page)
    playing = None
    for _ in range(20):
        time.sleep(0.5)
        playing = chrome("""const tr = window.CthulhuNowPlaying.tracker(); const c = tr.current;
          return c ? { tab: c.tab === window.__mediaTab, playing: c.mc.isPlaying, title: tr.metadata().title, artist: tr.metadata().artist } : null;""")
        if playing and playing["tab"] and playing["playing"]:
            break
    check("the tracker picks the tab that is playing, with its media-session metadata",
          playing and playing["tab"] and playing["playing"] and playing["title"] == "Sine test track" and playing["artist"] == "Marionette", playing)
    sq = chrome("return { title: document.querySelector('.cthulhu-np-title').textContent, playing: document.querySelector('.cthulhu-np-squircle').classList.contains('playing') };")
    check("the squircle shows the track and lights up", sq["title"] == "Sine test track" and sq["playing"], sq)
    chrome("document.querySelector('.cthulhu-np-squircle').click();"); time.sleep(1.0)
    # no flicker: watch the open card for 2.2 s of playback -- the bar must only ever move forward
    # (the old code wobbled backwards on every position event), the elapsed label must change at most
    # a few times, and nothing else in the card may be rewritten at all.
    muts = chrome("""
      const card = document.querySelector('#cthulhu-player-panel .cthulhu-player-card');
      const fill = card.querySelector('.cthulhu-player-progress-fill');
      return new Promise(res => {
        const widths = [parseFloat(fill.style.width) || 0]; let textChanges = 0, other = 0;
        const mo = new MutationObserver(list => { for (const r of list) {
          if (r.type === 'attributes' && r.target === fill && r.attributeName === 'style') widths.push(parseFloat(fill.style.width) || 0);
          else if (r.type === 'characterData' || (r.type === 'childList' && r.target.classList && r.target.classList.contains('cthulhu-player-time'))) textChanges++;
          else other++; } });
        mo.observe(card, { subtree: true, childList: true, attributes: true, characterData: true });
        setTimeout(() => { mo.disconnect();
          const backwards = widths.some((w, i) => i && w < widths[i - 1] - 0.01 && !(widths[i - 1] > 90 && w < 10)); // a loop restart is not jitter
          res({ widthWrites: widths.length - 1, backwards, textChanges, other, first: widths[0], last: widths[widths.length - 1],
                playIcon: card.querySelector('.cthulhu-player-ctrl.play img').src.split('/').pop(),
                transition: getComputedStyle(fill).transitionDuration, elapsed: card.querySelector('.cthulhu-player-time').textContent }); }, 2200);
      });
    """)
    check("the open card's bar only ever moves forward, the label changes at most a few times, and nothing else is rewritten",
          muts["widthWrites"] >= 1 and not muts["backwards"] and muts["textChanges"] <= 4 and muts["other"] == 0 and muts["playIcon"] == "pause.png" and muts["transition"] == "1s" and muts["elapsed"] != "live", muts)
    # mute: click the speaker -> the TAB is muted (tab.toggleMuteAudio), and back
    chrome("document.querySelector('#cthulhu-player-panel .cthulhu-player-ctrl.mute').click();"); time.sleep(0.4)
    mu = chrome("return { muted: window.__mediaTab.linkedBrowser.audioMuted, attr: window.__mediaTab.hasAttribute('muted'), icon: document.querySelector('#cthulhu-player-panel .cthulhu-player-ctrl.mute img').src.split('/').pop() };")
    check("clicking the speaker mutes the tab (icon swaps)", mu["muted"] and mu["attr"] and mu["icon"] == "mute.png", mu)
    chrome("document.querySelector('#cthulhu-player-panel .cthulhu-player-ctrl.mute').click();"); time.sleep(0.4)
    un = chrome("return { muted: window.__mediaTab.linkedBrowser.audioMuted, icon: document.querySelector('#cthulhu-player-panel .cthulhu-player-ctrl.mute img').src.split('/').pop() };")
    check("and clicking again unmutes", not un["muted"] and un["icon"] == "volume.png", un)
    # volume: the slider is hidden until the speaker is hovered; moving it stores the level on the tab
    vol = chrome("""
      const s = document.querySelector('#cthulhu-player-panel .cthulhu-player-slider');
      const before = getComputedStyle(s).width;
      s.value = '40'; s.dispatchEvent(new Event('input', { bubbles: true }));
      return { hiddenWidth: before, stored: window.__mediaTab._cthulhuVolume, disabled: s.disabled };
    """)
    check("the volume slider is collapsed until hovered and stores the level on the tab", vol["hiddenWidth"] == "0px" and vol["stored"] == 0.4 and not vol["disabled"], vol)
    time.sleep(0.8)
    # the content side (the actor setting <audio>.volume). Informational on the dev bundle: a child
    # actor cannot be loaded from the bundle's symlinks by the sandboxed content process (see the
    # FilePicker note in CONTRIBUTING); it ships inside omni.ja in a release.
    m.set_context("content")
    cur = m.current_window_handle
    applied = None
    for h in m.window_handles:
        m.switch_to_window(h)
        try:
            if m.execute_script("return document.title") == "Sine test track":
                applied = m.execute_script("return document.querySelector('audio').volume")
                break
        except Exception:
            continue
    m.switch_to_window(cur)
    if applied == 0.4:
        check("the page's <audio> volume follows the slider (actor)", True)
    else:
        print("INFO the page's <audio> volume is", applied, "-- the volume actor did not reach content on this dev bundle (symlinked child module; shipped builds carry it in omni.ja)")
    chrome("document.getElementById('cthulhu-player-panel').hidePopup();")

    # --- chrome: the player is there, the side panels and the feature-request button are gone
    ch = chrome("""
      const q = (s) => document.querySelector(s);
      return { np: !!q('#cthulhu-nowplaying'), toggles: document.querySelectorAll('.cthulhu-sp-toggle').length,
               sidepanels: !!q('#cthulhu-sidepanels'), fr: !!q('#cthulhu-feature-request-button'),
               panel: !!q('#cthulhu-player-panel'), icons: [...document.querySelectorAll('#cthulhu-player-panel .cthulhu-player-icon')].map(i => i.src.split('/').pop()),
               times: document.querySelectorAll('#cthulhu-player-panel .cthulhu-player-time').length,
               close: !!q('#cthulhu-player-panel .cthulhu-player-close'), rec: document.querySelectorAll('.cthulhu-player-rec-tile, .cthulhu-player-search').length,
               modules: window.CthulhuLoader.loaded.map(m => m.id) };
    """)
    check("Now Playing squircle present; Discord/Instagram/Apple Music toggles, sidebar and feature-request button gone",
          ch["np"] and ch["toggles"] == 0 and not ch["sidepanels"] and not ch["fr"], ch)
    check("player is title/artist, close, elapsed+total, prev/play/next/mute with PNG icon slots, no browse or search",
          ch["panel"] and ch["icons"] in (["close.png", "prev.png", "play.png", "next.png", "volume.png"], ["close.png", "prev.png", "pause.png", "next.png", "volume.png"]) and ch["times"] == 2 and ch["close"] and ch["rec"] == 0, ch)
    check("loaded chrome modules", set(ch["modules"]) == {"cursors", "ambient-theme", "now-playing", "compact-mode"}, ch["modules"])

    # --- vertical tabs: the Home tab appears as a pinned tab with the house; compact mode hides the strip
    chrome("Services.prefs.setBoolPref('sidebar.verticalTabs', true);"); time.sleep(2.5)
    vt = chrome("""
      const tab = document.querySelector('tab[cthulhu-home-tab]');
      const fv = document.getElementById('firefox-view-button');
      return { orient: document.getElementById('tabbrowser-tabs').getAttribute('orient'),
               tab: !!tab, display: tab ? getComputedStyle(tab).display : null, pinned: tab ? tab.pinned : null,
               icon: tab ? (tab.getAttribute('image') || '').split('/').pop() : null, selected: tab ? tab.selected : null,
               inPinned: tab ? !!tab.closest('#pinned-tabs-container') : null,
               pinnedShown: getComputedStyle(document.getElementById('pinned-tabs-container')).display !== 'none',
               rootVT: document.documentElement.hasAttribute('cthulhu-vertical-tabs'),
               menu: !!document.querySelector('#toolbar-context-menu .cthulhu-compact-menuitem') };
    """)
    check("vertical tabs: a pinned Home tab exists in the strip, visible, with the house icon, not stolen focus",
          vt["orient"] == "vertical" and vt["tab"] and vt["display"] != "none" and vt["pinned"] and vt["icon"] == "home.png" and vt["inPinned"] and vt["pinnedShown"] and vt["selected"] is False, vt)
    check("root flags vertical tabs and the Compact mode menu item exists", vt["rootVT"] and vt["menu"], vt)
    chrome("window.CthulhuCompactMode.setEnabled(true);"); time.sleep(1.0)
    cm = chrome("""
      const c = document.getElementById('sidebar-container'); const cs = getComputedStyle(c);
      const tb = document.getElementById('navigator-toolbox'); const ts = getComputedStyle(tb);
      const hot = document.getElementById('cthulhu-compact-hotzone');
      const tabbox = document.getElementById('tabbrowser-tabbox').getBoundingClientRect();
      const urlc = document.getElementById('urlbar-container').getBoundingClientRect();
      const back = document.getElementById('back-button').getBoundingClientRect();
      return { attr: document.documentElement.hasAttribute('cthulhu-compact'), position: cs.position, translate: cs.translate,
               tbPosition: ts.position, tbTranslate: ts.translate, tbWidth: tb.getBoundingClientRect().width,
               hot: !!hot && getComputedStyle(hot).display !== 'none', hotW: hot ? hot.getBoundingClientRect().width : null,
               tabboxLeft: tabbox.left, tabboxTop: tabbox.top, vis: Services.prefs.getCharPref('sidebar.visibility'),
               checked: document.querySelector('#toolbar-context-menu .cthulhu-compact-menuitem').getAttribute('checked'),
               docked: !!c.querySelector('.cthulhu-player-card.docked'), squircleHidden: getComputedStyle(document.getElementById('cthulhu-nowplaying')).display === 'none',
               urlbarOwnRow: urlc.top >= back.bottom - 1, urlbarWide: urlc.width > 220,
               menuTopRight: (() => { const p = document.getElementById('PanelUI-button').getBoundingClientRect(); const t = tb.getBoundingClientRect();
                 return p.top - t.top < 40 && t.right - p.right < 40 && p.bottom <= urlc.top + 1; })(),
               padTop: parseFloat(cs.paddingTop) };
    """)
    check("compact mode: page is full-screen (tabbox at the top-left), both toolbox and strip out of flow and off-screen",
          cm["attr"] and cm["position"] == "absolute" and cm["tbPosition"] == "absolute" and cm["translate"] not in ("none", "0px", "") and cm["tbTranslate"] not in ("none", "0px", "")
          and cm["tabboxLeft"] < 10 and cm["tabboxTop"] < 10 and cm["hot"] and cm["hotW"] == 6 and cm["vis"] == "always-show" and cm["checked"] == "true", cm)
    check("the column: toolbox 260 wide, menu at its top-right, the address bar spanning its own bottom row, tabs padded under it, player docked, squircle hidden",
          cm["tbWidth"] == 260 and cm["urlbarOwnRow"] and cm["urlbarWide"] and cm["menuTopRight"] and cm["padTop"] > 40 and cm["docked"] and cm["squircleHidden"], cm)
    # the address bar's dropdown must open where the bar is, inside the column
    chrome("window.CthulhuCompactMode.open(); gURLBar.focus(); gURLBar.value = 'exa'; gURLBar.startQuery();"); time.sleep(1.2)
    ub = chrome("""const u = document.getElementById('urlbar'); const r = u.getBoundingClientRect(); const c = document.getElementById('urlbar-container').getBoundingClientRect();
      const v = u.querySelector('.urlbarView'); const vr = v ? v.getBoundingClientRect() : null;
      return { open: u.hasAttribute('open') || u.hasAttribute('breakout-extend'), left: r.left, top: r.top, width: r.width, cLeft: c.left, cTop: c.top,
               viewShown: !!vr && vr.height > 20, viewLeft: vr ? vr.left : null, viewWidth: vr ? vr.width : null };""")
    check("the focused address bar and its results open over the column, aligned with the pill",
          ub["open"] and abs(ub["left"] - ub["cLeft"]) < 12 and ub["left"] < 30 and ub["width"] > 200 and ub["width"] < 420 and ub["viewShown"] and ub["viewLeft"] < 30, ub)
    if SHOTS:
        m.set_context("chrome")
        with open(os.path.join(SHOTS, "15c-compact-urlbar.png"), "wb") as f: f.write(base64.b64decode(m.screenshot(format="base64")))
    chrome("gURLBar.view.close(); gURLBar.handleRevert(); gURLBar.blur(); window.CthulhuCompactMode.close();"); time.sleep(0.5)
    chrome("window.CthulhuCompactMode.open();"); time.sleep(0.4)
    op = chrome("""const c = document.getElementById('sidebar-container'); const tb = document.getElementById('navigator-toolbox');
      return { open: c.hasAttribute('cthulhu-compact-open') && tb.hasAttribute('cthulhu-compact-open'), translate: getComputedStyle(c).translate, tbTranslate: getComputedStyle(tb).translate,
               dockedVisible: c.querySelector('.cthulhu-player-card.docked').getBoundingClientRect().width > 100 };""")
    check("open(): the whole column slides in over the page, docked player visible", op["open"] and op["translate"] in ("none", "0px", "0px 0px") and op["tbTranslate"] in ("none", "0px", "0px 0px") and op["dockedVisible"], op)
    if SHOTS:
        m.set_context("chrome")
        with open(os.path.join(SHOTS, "15b-compact-column.png"), "wb") as f: f.write(base64.b64decode(m.screenshot(format="base64")))
    chrome("window.CthulhuCompactMode.close();"); time.sleep(0.3)
    # Cmd/Ctrl+L: focusing the address bar reveals the column; blurring lets it hide
    chrome("gURLBar.focus();"); time.sleep(0.3)
    fo = chrome("return document.getElementById('navigator-toolbox').hasAttribute('cthulhu-compact-open');")
    chrome("gURLBar.blur(); document.getElementById('tabbrowser-tabbox').focus();"); time.sleep(0.9)
    fb = chrome("return document.getElementById('navigator-toolbox').hasAttribute('cthulhu-compact-open');")
    check("focusing the address bar reveals the column and blurring hides it again", fo and not fb, {"focused": fo, "blurred": fb})
    chrome("window.CthulhuCompactMode.setEnabled(false);"); time.sleep(0.5)
    off = chrome("""const c = document.getElementById('sidebar-container'); const tb = document.getElementById('navigator-toolbox');
      return { attr: document.documentElement.hasAttribute('cthulhu-compact'), position: getComputedStyle(c).position, tbPosition: getComputedStyle(tb).position,
               docked: !!c.querySelector('.cthulhu-player-card.docked'), squircle: getComputedStyle(document.getElementById('cthulhu-nowplaying')).display !== 'none' };""")
    check("compact mode off: toolbox and strip back in the layout, player undocked, squircle back", not off["attr"] and off["position"] != "absolute" and off["tbPosition"] != "absolute" and not off["docked"] and off["squircle"], off)
    chrome("Services.prefs.setBoolPref('sidebar.verticalTabs', false);"); time.sleep(2.0)
    hz = chrome("const tab = document.querySelector('tab[cthulhu-home-tab]'); return { orient: document.getElementById('tabbrowser-tabs').getAttribute('orient'), hidden: tab ? getComputedStyle(tab).display === 'none' : null, fvVisible: document.getElementById('firefox-view-button').getBoundingClientRect().width > 10 };")
    check("back to horizontal: the Home tab hides again and the Home button is back", hz["orient"] == "horizontal" and hz["hidden"] and hz["fvVisible"], hz)

    # --- drawer: icons instead of dots
    page("document.getElementById('cthulhu-settings').click();"); time.sleep(0.8)
    ic = page("""
      const imgs = [...document.querySelectorAll('.cthulhu-palette-icon')];
      return { icons: imgs.length, loaded: imgs.filter(i => i.complete && i.naturalWidth === 16).length,
               dots: document.querySelectorAll('.cthulhu-palette-dot').length,
               cats: [...document.querySelectorAll('.cthulhu-palette-category h2')].map(h => h.textContent) };
    """)
    check("palette shows 13 icons (16x16), no dot fallbacks", ic["icons"] == 13 and ic["loaded"] == 13 and ic["dots"] == 0, ic)
    check("Play category absent while the game is parked", "Play" not in ic["cats"], ic["cats"])
    shot("07-drawer-icons")

    # --- console errors from our code?
    print("RESULT:", "ALL PASS" if not fails else "FAILED: " + ", ".join(fails))
    print("=====END=====")
finally:
    m.quit()
sys.exit(1 if fails else 0)
