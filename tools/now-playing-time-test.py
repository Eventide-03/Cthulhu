"""Check that the player shows the CURRENT track's time, not the queue's
(src/theme/content/modules/now-playing).

    cd engine && ./mach python ../tools/now-playing-time-test.py

Some players give a whole queue ONE continuous timeline -- each track is
appended to the same media element -- so the position and duration they report
are measured from the start of the FIRST track and grow with every song. The
card used to show those numbers raw, so by the fourth song a four-minute track
read "15:23 / 15:50". The tracker now records a track boundary wherever the
metadata changes on a timeline that did not restart, and shows the window
between the boundary below the playhead and the one above it.

Both kinds of player are driven here through a fake MediaController stood on a
real tab: the controller is the only thing the tracker reads, and a fake one
makes the timeline exact instead of depending on this Mac's audio output (which
hangs -- see home-widgets-test.py).
"""
import os, sys, time, tempfile, subprocess
from marionette_driver.marionette import Marionette

BIN = os.path.join(os.getcwd(), "obj-aarch64-apple-darwin25.5.0", "dist", "Cthulhu.app", "Contents", "MacOS", "Cthulhu")
subprocess.run([os.path.join(os.path.dirname(os.path.abspath(__file__)), "dev-actors.sh")], check=False)

m = Marionette(bin=BIN, gecko_log="-", prefs={"marionette.log.level": "Error"},
               app_args=["-remote-allow-system-access", "-profile", tempfile.mkdtemp(prefix="cthulhu-nptime-")])
m.start_session()
fails = []
def check(label, ok, extra=""):
    print(("PASS " if ok else "FAIL ") + label + ("  " + str(extra) if extra != "" else ""))
    if not ok: fails.append(label)
def chrome(js, *a):
    m.set_context("chrome"); return m.execute_script(js, script_args=a)
def poll(fn, want, tries=30, gap=0.4):
    v = None
    for _ in range(tries):
        v = fn()
        if want(v): return v
        time.sleep(gap)
    return v
def near(a, b, tol=2.5):
    return a is not None and abs(a - b) <= tol
# "just into the track": the fake events are fired against the real wall clock,
# which the tracker extrapolates over, so a freshly started track is a second or
# three in by the time the state is read. The point of these checks is that it is
# seconds and not the twelve minutes the page reported.
def just_started(a):
    return a is not None and 0 <= a < 8

# A song change on a continuous timeline: the page updates its metadata and
# keeps counting, so the next position state carries on where the last stopped.
def song(title, at, total, gap=0.25):
    chrome("window.__fakeMc.mc._meta = { title: arguments[0], artist: 'Marionette' }; window.__fakeMc.fire('metadatachange');", title)
    time.sleep(gap)
    chrome("window.__fakeMc.fire('positionstatechange', { position: arguments[0], duration: arguments[1], playbackRate: 1 });", at, total)
    time.sleep(gap)
def state():
    return chrome("""const tr = window.CthulhuNowPlaying.tracker();
      return { dur: tr.duration, pos: tr.extrapolatedPosition(), title: tr.metadata().title };""")

try:
    print("=====NOW PLAYING / TRACK TIME=====")
    loaded = chrome("return window.CthulhuLoader.loaded.map(m => m.id);")
    check("the module loaded", "now-playing" in loaded, loaded)

    # --- a real tab wearing a fake MediaController (same trick as home-widgets-test.py)
    chrome("""
      const t = gBrowser.addTab('about:blank', { triggeringPrincipal: Services.scriptSecurityManager.getSystemPrincipal() });
      gBrowser.selectedTab = t; window.__mediaTab = t;
      const browser = t.linkedBrowser;
      let p = Object.getPrototypeOf(browser), desc = null;
      while (p && !(desc = Object.getOwnPropertyDescriptor(p, 'browsingContext'))) p = Object.getPrototypeOf(p);
      const realBC = () => desc.get.call(browser);
      const mc = new EventTarget();
      Object.assign(mc, { isActive: true, isPlaying: true, isAudible: true,
        supportedKeys: ['play', 'pause', 'previoustrack', 'nexttrack', 'seekto'],
        _meta: { title: 'Track one', artist: 'Marionette' }, getMetadata() { return this._meta; },
        play() { this.isPlaying = true; fire('playbackstatechange'); },
        pause() { this.isPlaying = false; fire('playbackstatechange'); },
        seekTo(t) { this._seek = t; }, prevTrack() {}, nextTrack() {} });
      const fire = (type, props) => { const e = new Event(type); Object.assign(e, props || {}); mc.dispatchEvent(e); };
      const proxy = new Proxy({}, { get(_, k) { const t = realBC(); if (k === 'mediaController') return mc; const v = Reflect.get(t, k); return typeof v === 'function' ? v.bind(t) : v; } });
      Object.defineProperty(browser, 'browsingContext', { configurable: true, get: () => proxy });
      window.__fakeMc = { mc, fire, restore() { delete browser.browsingContext; } };
      window.CthulhuNowPlaying.tracker();
      return true;
    """)
    got = poll(lambda: chrome("const c = window.CthulhuNowPlaying.tracker().current; return c ? c.tab === window.__mediaTab : false;"),
               lambda v: v is True)
    check("the tracker picked the tab", got is True, got)

    # ---------------- a continuous-timeline player (four 4-minute tracks) ----
    chrome("window.__fakeMc.fire('positionstatechange', { position: 5, duration: 240, playbackRate: 1 });"); time.sleep(0.3)
    s = state()
    check("track 1 reads its own position and length", near(s["dur"], 240) and near(s["pos"], 5), s)

    chrome("window.__fakeMc.fire('positionstatechange', { position: 239, duration: 240, playbackRate: 1 });"); time.sleep(0.2)
    song("Track two", 240.5, 480)
    s = state()
    check("track 2 of a continuous timeline reads 0:0x of 4:00, not 4:00 of 8:00",
          near(s["dur"], 241) and just_started(s["pos"]) and s["title"] == "Track two", s)

    chrome("window.__fakeMc.fire('positionstatechange', { position: 478, duration: 480, playbackRate: 1 });"); time.sleep(0.2)
    song("Track three", 480.5, 720)
    chrome("window.__fakeMc.fire('positionstatechange', { position: 718, duration: 720, playbackRate: 1 });"); time.sleep(0.2)
    song("Endless Adventure", 720.5, 950)
    s = state()
    check("and the fourth song reads 0:0x of 3:5x -- the reported 15:50 queue is not shown",
          near(s["dur"], 232) and just_started(s["pos"]) and s["title"] == "Endless Adventure", s)

    # the card itself, which is what the screenshot showed
    chrome("""
      const box = document.createElement('div'); box.id = '__npbox';
      document.documentElement.appendChild(box);
      window.CthulhuNowPlaying.dock(box); return true;
    """)
    time.sleep(0.6)
    lab = chrome("""const t = [...document.querySelectorAll('#__npbox .cthulhu-player-time')].map(e => e.textContent);
      return { elapsed: t[0], total: t[1], title: document.querySelector('#__npbox .cthulhu-player-title').textContent };""")
    check("the card's own labels agree -- a few seconds into a 3:5x track",
          lab["total"].startswith("3:5") and lab["elapsed"].startswith("0:0") and lab["title"] == "Endless Adventure", lab)

    # seeking is in the track's frame, but the page is told where on ITS timeline to go
    chrome("window.CthulhuNowPlaying.tracker().seek(0.5);"); time.sleep(0.3)
    sk = chrome("return window.__fakeMc.mc._seek;")
    check("seeking to the middle of the track asks the page for the middle of THAT track",
          near(sk, 720 + 115, 4), sk)

    # ---------------- a per-track player must be untouched --------------------
    chrome("window.__fakeMc.mc._meta = { title: 'Fresh start', artist: 'Marionette' }; window.__fakeMc.fire('metadatachange');"); time.sleep(0.25)
    chrome("window.__fakeMc.fire('positionstatechange', { position: 0.3, duration: 180, playbackRate: 1 });"); time.sleep(0.3)
    s = state()
    check("a player that restarts its timeline each track is shown its own numbers",
          near(s["dur"], 180) and near(s["pos"], 0.3) and s["title"] == "Fresh start", s)
    chrome("window.__fakeMc.fire('positionstatechange', { position: 90, duration: 180, playbackRate: 1 });"); time.sleep(0.3)
    s = state()
    check("halfway through it, the card is halfway", near(s["dur"], 180) and near(s["pos"], 90), s)
    chrome("window.CthulhuNowPlaying.tracker().seek(0.25);"); time.sleep(0.3)
    sk = chrome("return window.__fakeMc.mc._seek;")
    check("and seeking it is a plain fraction of its duration", near(sk, 45, 3), sk)

    # ---------------- a live stream still says live ---------------------------
    chrome("window.__fakeMc.fire('positionstatechange', { position: 0, duration: 0, playbackRate: 1 });"); time.sleep(0.5)
    lab = chrome("""const t = [...document.querySelectorAll('#__npbox .cthulhu-player-time')].map(e => e.textContent); return t;""")
    check("no duration reported still reads live", lab and lab[0] == "live", lab)

    chrome("window.CthulhuNowPlaying.undock(); document.getElementById('__npbox').remove(); window.__fakeMc.restore(); delete window.__fakeMc;")
finally:
    try: m.quit()
    except Exception: pass
print()
print(("FAILURES: " + ", ".join(fails)) if fails else "ALL PASS")
sys.exit(1 if fails else 0)
