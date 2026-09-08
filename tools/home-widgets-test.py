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
      H.addWidgetByType('calendar',  {x:0, y:0, w:3, h:3});
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
    check("tools do not overlap the calendar's mode/⟳/‹/Today/› buttons", r["nBtns"] == 5 and not r["overlapsAny"],
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
          extendedProperties:{shared:{cthulhuKind:'task'}} },
        { id:'C', summary:'single', start:{date:cd}, end:{date:exclusive(cd)}, creator:{self:true} },
      ]);
      const seg = (id) => { const b = c.querySelector('.cw-cal-ev[data-event-id="'+id+'"]'); return b ? { col: b.style.gridColumn, row: b.style.gridRow, cls: b.className, week: [...c.querySelectorAll('.cw-cal-week')].indexOf(b.parentElement), pill: (b.querySelector('.cw-cal-pill')||{}).textContent || '', handles: b.querySelectorAll('.cw-cal-rz').length } : null; };
      return { n: c.querySelectorAll('.cw-cal-ev').length, A: seg('A'), B: seg('B'), C: seg('C') };
    """, a_first.isoformat(), a_last.isoformat(), b_day.isoformat(), c_day.isoformat())
    print("BOARD", laid)
    check("three injected items rendered as boxes", laid["n"] == 3, laid["n"])
    check("A is ONE bar spanning three columns with both resize handles", laid["A"] and laid["A"]["col"] == "2 / 5" and laid["A"]["handles"] == 2 and "Project" == laid["A"]["pill"], laid["A"])
    check("B (same day, timed, theirs) drops to the next lane and is dashed", laid["B"] and laid["B"]["row"] == "3" and "theirs" in laid["B"]["cls"], laid["B"])
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

    # click (no movement) on a name -> inline rename box
    title_el = m.find_element("css selector", '.cw-cal-ev[data-event-id="C"] .cw-cal-ev-title')
    m.actions.sequence("pointer", "mouse", {"pointerType": "mouse"}).pointer_move(0, 0, origin=title_el).pointer_down().pointer_up().perform()
    time.sleep(0.3)
    ren = page("""
      const i = document.querySelector('.cw-cal-ev[data-event-id="C"] .cw-cal-ev-title input');
      return i ? { value: i.value, focused: document.activeElement === i } : null;
    """)
    check("click on a name opens an inline rename with the old name", ren and ren["value"] == "single" and ren["focused"], ren)
    page("const i = document.querySelector('.cw-cal-ev-title input'); if (i) i.dispatchEvent(new KeyboardEvent('keydown', {key:'Escape', bubbles:true}));")
    shot("02b-calendar-board")

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
    page("w.CthulhuThemes.setTheme('night');"); time.sleep(0.5)

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
