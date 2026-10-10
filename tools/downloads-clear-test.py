"""Check the Clear Downloads button in the downloads panel
(src/theme/content/modules/downloads-clear).

    cd engine && ./mach python ../tools/downloads-clear-test.py

Drives the real panel against real download entries added through
DownloadsCommon's own list, so the button is clicked exactly as a user clicks
it and the list it clears is the one the panel is showing.
"""
import os, sys, time, tempfile, subprocess
from marionette_driver.marionette import Marionette

BIN = os.path.join(os.getcwd(), "obj-aarch64-apple-darwin25.5.0", "dist", "Cthulhu.app", "Contents", "MacOS", "Cthulhu")
subprocess.run([os.path.join(os.path.dirname(os.path.abspath(__file__)), "dev-actors.sh")], check=False)
DLDIR = tempfile.mkdtemp(prefix="cthulhu-dl-")

m = Marionette(bin=BIN, gecko_log="-", prefs={"marionette.log.level": "Error"},
               app_args=["-remote-allow-system-access", "-profile", tempfile.mkdtemp(prefix="cthulhu-dlclear-")])
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

try:
    print("=====DOWNLOADS CLEAR=====")
    loaded = chrome("return window.CthulhuLoader.loaded.map(m => m.id);")
    check("the module loaded", "downloads-clear" in loaded, loaded)

    where = chrome("""
      const b = document.getElementById('cthulhu-downloads-clear');
      if (!b) return null;
      const footer = document.getElementById('downloadsFooterButtons');
      const kids = [...footer.children].map(e => e.id || e.localName);
      return { inFooter: b.parentNode === footer, order: kids,
               l10n: b.getAttribute('data-l10n-id'),
               classes: b.getAttribute('class') };
    """)
    check("the button exists and sits in the panel's footer", bool(where) and where["inFooter"], where)
    check("it comes after Show All Downloads",
          bool(where) and where["order"] == ["toolbarseparator", "downloadsHistory", "cthulhu-downloads-clear"],
          where and where["order"])
    check("it uses Firefox's own translated string, adding none of its own",
          bool(where) and where["l10n"] == "downloads-clear-downloads-button", where and where["l10n"])
    check("it wears the panel's footer-button classes, so it is styled like its neighbour",
          bool(where) and "panel-subview-footer-button" in where["classes"], where and where["classes"])

    # --- real download entries in the panel's own list
    chrome("""
      const { Downloads } = ChromeUtils.importESModule('resource://gre/modules/Downloads.sys.mjs');
      window.__dl = (async () => {
        const list = await Downloads.getList(Downloads.ALL);
        for (let i = 0; i < 3; i++) {
          const d = await Downloads.createDownload({
            source: 'https://example.com/f' + i + '.bin',
            target: arguments[0] + '/f' + i + '.bin',
          });
          d.stopped = true; d.succeeded = true; d.hasProgress = true; d.progress = 100;
          await list.add(d);
        }
        return (await list.getAll()).length;
      })();
      return true;
    """, DLDIR)
    n = poll(lambda: chrome("return window.__dl_n ?? (window.__dl.then(v => window.__dl_n = v), null);"),
             lambda v: v is not None)
    check("three downloads are in the list", n == 3, n)

    # --- open the real panel
    chrome("DownloadsPanel.showPanel();")
    state = poll(lambda: chrome("return document.getElementById('downloadsPanel').state;"),
                 lambda v: v == "open")
    check("the downloads panel opened", state == "open", state)
    shown = chrome("""
      const b = document.getElementById('cthulhu-downloads-clear');
      const r = b.getBoundingClientRect();
      return { visible: r.width > 0 && r.height > 0, disabled: b.disabled,
               label: b.label || b.getAttribute('label'),
               rows: document.getElementById('downloadsListBox').itemCount };
    """)
    check("it is visible in the open panel, enabled, and reads 'Clear Downloads'",
          shown["visible"] and shown["disabled"] is False and shown["label"] == "Clear Downloads", shown)
    check("the panel is listing the three downloads", shown["rows"] == 3, shown["rows"])

    # --- click it for real
    chrome("document.getElementById('cthulhu-downloads-clear').click();")
    left = poll(lambda: chrome("""
        const { Downloads } = ChromeUtils.importESModule('resource://gre/modules/Downloads.sys.mjs');
        if (window.__left === undefined) {
          window.__left = null;
          Downloads.getList(Downloads.ALL).then(l => l.getAll()).then(a => window.__left = a.length);
        }
        return window.__left;
      """), lambda v: v is not None)
    check("clicking it clears the finished downloads", left == 0, left)
    closed = poll(lambda: chrome("return document.getElementById('downloadsPanel').state;"),
                  lambda v: v in ("closed", "hiding"))
    check("and the panel closes rather than sitting there empty", closed == "closed", closed)

    # --- nothing left to clear: the button greys out, it does not vanish
    chrome("delete window.__left; DownloadsPanel.showPanel();")
    poll(lambda: chrome("return document.getElementById('downloadsPanel').state;"), lambda v: v == "open")
    after = poll(lambda: chrome("""
        const b = document.getElementById('cthulhu-downloads-clear');
        const r = b.getBoundingClientRect();
        return { disabled: b.disabled, visible: r.width > 0 && r.height > 0 };
      """), lambda v: v and v["disabled"] is True, tries=12)
    check("with nothing to clear it greys out but stays put (the footer keeps its height)",
          after["disabled"] is True and after["visible"], after)

    print("RESULT:", "ALL PASS" if not fails else "FAILED: " + ", ".join(fails))
    sys.exit(1 if fails else 0)
finally:
    try: m.quit()
    except Exception: pass
