"""Check the cursor theme and its auto-hide over video
(src/theme/content/modules/cursors).

    cd engine && ./mach python ../tools/cursor-test.py

The theme is a global USER_SHEET, so it has to reach WEB CONTENT and not just
chrome -- and in a dev build it only does once cursors.css is a real file in
the bundle rather than a symlink out of it (tools/dev-actors.sh, run below).
The first check here is that it reached content at all; without it the rest
would pass vacuously on a build where the theme is simply absent.

Note: this moves the pointer. If you jog the real mouse over the window mid-run
the idle checks can wake early and fail -- rerun before believing them.
"""
import os, sys, time, base64, struct, math, tempfile, subprocess
from marionette_driver.marionette import Marionette
from marionette_driver.by import By

BIN = os.path.join(os.getcwd(), "obj-aarch64-apple-darwin25.5.0", "dist", "Cthulhu.app", "Contents", "MacOS", "Cthulhu")
subprocess.run([os.path.join(os.path.dirname(os.path.abspath(__file__)), "dev-actors.sh")], check=False)

# A silent 30 s video. Silent on purpose: autoplay stays allowed and nothing
# has to be heard for the pointer logic, which only reads playback state.
rate, secs = 8000, 30
frames = b"\x00\x00" * (rate * secs)
wav = (b"RIFF" + struct.pack("<I", 36+len(frames)) + b"WAVEfmt " + struct.pack("<IHHIIHH",16,1,1,rate,rate*2,2,16)
       + b"data" + struct.pack("<I", len(frames)) + frames)
WAV = "data:audio/wav;base64," + base64.b64encode(wav).decode()

m = Marionette(bin=BIN, gecko_log="-", prefs={"marionette.log.level": "Error"},
               app_args=["-remote-allow-system-access", "-profile", tempfile.mkdtemp(prefix="cthulhu-cursor-")])
m.start_session()
fails = []
def check(label, ok, extra=""):
    print(("PASS " if ok else "FAIL ") + label + ("  " + str(extra) if extra != "" else ""))
    if not ok: fails.append(label)
def chrome(js, *a):
    m.set_context("chrome"); return m.execute_script(js, script_args=a)
def page(js, *a):
    m.set_context("content"); return m.execute_script(js, script_args=a)
def cursor_of(sel):
    return page("return getComputedStyle(document.querySelector(arguments[0])).cursor;", sel)
def wait_cursor(sel, want, tries=16, gap=0.5):
    v = None
    for _ in range(tries):
        v = cursor_of(sel)
        if (v == "none") == want: return v
        time.sleep(gap)
    return v

TABBY = 'url("chrome://cthulhu-cursors/content/default.png") 1 1, auto'
try:
    chrome("Services.prefs.setIntPref('media.autoplay.default', 0);"
           "Services.prefs.setIntPref('media.autoplay.blocking_policy', 0);")
    print("=====CURSORS=====")
    reg = chrome("""
      const sss = Cc['@mozilla.org/content/style-sheet-service;1'].getService(Ci.nsIStyleSheetService);
      return sss.sheetRegistered(Services.io.newURI('chrome://cthulhu/content/modules/cursors/cursors.css'), sss.USER_SHEET);
    """)
    check("the cursor sheet is registered as a user sheet", reg is True, reg)

    m.set_context("content")
    m.navigate("https://example.com/")
    time.sleep(2)
    page("""
      document.body.innerHTML = '';
      const mk = (id, w, h) => {
        const v = document.createElement('video');
        v.id = id; v.loop = true; v.muted = true; v.playsInline = true;
        v.style.cssText = 'display:block;width:' + w + 'px;height:' + h + 'px;background:#000';
        v.src = arguments[0];
        document.body.appendChild(v);
        v.play().catch(() => {});
        return v;
      };
      mk('big', 640, 360);      // a thing you sit and watch
      mk('small', 160, 90);     // a thumbnail
      const d = document.createElement('div');
      d.id = 'plain'; d.textContent = 'not a video'; d.style.cssText = 'height:200px';
      document.body.appendChild(d);
      return true;
    """, WAV)
    time.sleep(2)
    check("the theme reaches WEB CONTENT, not just chrome (a dev build needs the real file)",
          cursor_of("#plain") == TABBY, cursor_of("#plain"))
    playing = page("return [...document.querySelectorAll('video')].map(v => !v.paused && v.readyState >= 2);")
    check("both test videos are playing", playing == [True, True], playing)

    # --- the pointer settles over the big one
    m.set_context("content")
    big = m.find_element(By.ID, "big")
    m.actions.sequence("pointer", "mouse").pointer_move(0, 0, origin=big).pause(100).perform()
    time.sleep(0.5)
    check("while the pointer is moving, the theme's cursor is showing",
          cursor_of("#big") == TABBY, cursor_of("#big"))
    v = wait_cursor("#big", True)
    check("after sitting still over a playing video, the pointer hides", v == "none", v)
    check("and the whole document goes with it, not just the video element",
          cursor_of("#plain") == "none", cursor_of("#plain"))

    # --- moving brings it back
    m.actions.sequence("pointer", "mouse").pointer_move(5, 5, origin=big).pause(50).pointer_move(-20, -10, origin=big).perform()
    v = wait_cursor("#big", False, tries=8)
    check("the smallest movement brings it straight back", v == TABBY, v)

    # --- a thumbnail is not something you are watching
    small = m.find_element(By.ID, "small")
    m.actions.sequence("pointer", "mouse").pointer_move(0, 0, origin=small).pause(100).perform()
    v = wait_cursor("#small", True, tries=9)
    check("sitting still over a small video does NOT hide it (a thumbnail, not a film)",
          v == TABBY, v)

    # --- nor is a page with nothing playing
    m.actions.sequence("pointer", "mouse").pointer_move(0, 0, origin=big).pause(100).perform()
    v = wait_cursor("#big", True)
    check("still hides again back over the big one", v == "none", v)
    page("document.querySelectorAll('video').forEach(v => v.pause()); return true;")
    v = wait_cursor("#big", False, tries=8)
    check("pausing the video brings the pointer back at once", v == TABBY, v)
    m.actions.sequence("pointer", "mouse").pointer_move(0, 0, origin=big).pause(100).perform()
    v = wait_cursor("#big", True, tries=9)
    check("and with nothing playing it stays put however long you wait", v == TABBY, v)

    print("RESULT:", "ALL PASS" if not fails else "FAILED: " + ", ".join(fails))
    sys.exit(1 if fails else 0)
finally:
    try: m.quit()
    except Exception: pass
