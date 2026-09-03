"""End-to-end check of the home page (about:cthulhu) against the built app:
widget registry, the browser-wide theme engine (page AND chrome follow the
pref), hover-tool placement vs. a widget's own header controls, the gradient /
orb / palette / deadlines / reference-board / minigame widgets, and the palette
icons. Runs offline in a throwaway profile.

    cd engine && ./mach python ../tools/home-widgets-test.py
    SHOTS=/some/dir ./mach python ../tools/home-widgets-test.py   # also save PNGs

The layout it builds assumes a 10x5 grid (a 1560px-wide window; the display
caps the height), so the "nothing displaced" check fails on a smaller screen
rather than meaning anything is wrong.
"""

import os, sys, time, base64, tempfile, json
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
    for want in ["theme", "gradient", "orb", "palette", "refboard", "deadlines", "game", "calendar"]:
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
      H.addWidgetByType('deadlines', {x:4, y:3, w:3, h:2});
      H.addWidgetByType('game',      {x:7, y:3, w:3, h:2});
    """)
    time.sleep(3)
    n = page("return document.querySelectorAll('#grid .cthulhu-widget').length;")
    check("8 widgets mounted", n == 8, n)
    grid = page("return { cols: w.__cthulhuGrid.getColumn(), rows: w.__cthulhuGrid.opts.maxRow, nodes: w.__cthulhuGrid.engine.nodes.map(n => n.el._cthulhu.id + '@' + n.x + ',' + n.y + ' ' + n.w + 'x' + n.h) };")
    print("GRID", grid)
    check("every widget kept its requested cell (nothing displaced)",
          set(grid["nodes"]) == {"calendar@0,0 3x3","theme@3,0 3x3","gradient@6,0 2x3","refboard@8,0 2x3","palette@0,3 2x2","orb@2,3 2x2","deadlines@4,3 3x2","game@7,3 3x2"})
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
    check("tools do not overlap the calendar's Mine/refresh/+ buttons", r["nBtns"] == 3 and not r["overlapsAny"],
          "buttons=%d firstBtnTop=%s" % (r["nBtns"], r["firstBtnTop"]))
    # hover to show them in a screenshot
    m.set_context("content")
    cal_el = m.find_element("css selector", ".cw-cal-head")
    m.actions.sequence("pointer", "mouse", {"pointerType": "mouse"}).pointer_move(0, 0, origin=cal_el).perform()
    time.sleep(0.5)
    vis = page("""
      const cal = [...document.querySelectorAll('#grid .grid-stack-item')].find(e => e._cthulhu && e._cthulhu.id === 'calendar');
      return getComputedStyle(cal.querySelector('.cthulhu-widget-tools')).opacity;
    """)
    check("tools visible on hover", vis == "1", vis)
    shot("02-calendar-hover")

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
    ps2 = page("return { n: document.querySelectorAll('.cw-pal-sw').length, opts: document.querySelector('.cw-pal-bar select').options.length };")
    check("dice made a new 5-colour palette and selected it", ps2 == {"n": 5, "opts": 2}, ps2)

    # --- deadlines: add via the form
    page("""
      const f = document.querySelector('.cw-dl-add'); f.querySelector('input[type=text]').value = 'Life drawing crit';
      const d = new Date(Date.now() + 86400000); f.querySelector('input[type=date]').value = d.toISOString().slice(0,10);
      f.requestSubmit();
    """); time.sleep(0.8)
    dl = page("return [...document.querySelectorAll('.cw-dl-row')].map(r => r.querySelector('.cw-dl-when').textContent);")
    check("deadline added with a countdown", dl == ["tomorrow"], dl)

    # --- refboard renders empty state + add button
    rb = page("return { empty: !!document.querySelector('.cw-ref-empty'), add: !!document.querySelector('.cw-ref-btn') };")
    check("reference board empty state + add button", rb == {"empty": True, "add": True}, rb)

    # --- game: world loaded, click-to-walk moves the companion, story shows
    time.sleep(1.5)
    gm = page("""
      const el = [...document.querySelectorAll('#grid .grid-stack-item')].find(e => e._cthulhu && e._cthulhu.id === 'game');
      return { loaded: !el.querySelector('.cw-game-msg'), dialog: !!el.querySelector('.cw-game-dialog'),
               name: el.querySelector('.cw-game-name').textContent, day: el.querySelector('.cw-game-day').textContent,
               pos: JSON.stringify(el._cthulhu.config.save && el._cthulhu.config.save.pos) };
    """)
    check("game world loaded", gm["loaded"], gm)
    check("game story chapter shown on day 1", gm["dialog"] and gm["day"] == "day 1", gm)
    before = gm["pos"]
    m.set_context("content")
    cv = m.find_element("css selector", ".cw-game-canvas")
    m.actions.sequence("pointer", "mouse", {"pointerType": "mouse"}).click(element=cv).perform()   # centre of the canvas
    time.sleep(1.5)
    after = page("""
      const el = [...document.querySelectorAll('#grid .grid-stack-item')].find(e => e._cthulhu && e._cthulhu.id === 'game');
      return JSON.stringify(el._cthulhu.config.save.pos);
    """)
    check("click-to-walk moved the companion", after != before, before + " -> " + after)
    shot("06-game")

    # --- drawer: icons instead of dots
    page("document.getElementById('cthulhu-settings').click();"); time.sleep(0.8)
    ic = page("""
      const imgs = [...document.querySelectorAll('.cthulhu-palette-icon')];
      return { icons: imgs.length, loaded: imgs.filter(i => i.complete && i.naturalWidth === 16).length,
               dots: document.querySelectorAll('.cthulhu-palette-dot').length,
               cats: [...document.querySelectorAll('.cthulhu-palette-category h2')].map(h => h.textContent) };
    """)
    check("palette shows 16 icons (16x16), no dot fallbacks", ic["icons"] == 16 and ic["loaded"] == 16 and ic["dots"] == 0, ic)
    check("Play category present", "Play" in ic["cats"], ic["cats"])
    shot("07-drawer-icons")

    # --- console errors from our code?
    print("RESULT:", "ALL PASS" if not fails else "FAILED: " + ", ".join(fails))
    print("=====END=====")
finally:
    m.quit()
sys.exit(1 if fails else 0)
