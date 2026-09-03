"""End-to-end check for Ctrl/Cmd+W on pinned tabs (src/browser/base/content/
browser-commands.patch): a pinned tab is UNLOADED rather than closed, the Home
tab is exempt, and ordinary tabs still close.

    cd engine && ./mach python ../tools/pinned-unload-test.py

Needs ./mach python (the in-tree marionette_driver) and a built app bundle.
Serves its own local page, so it runs offline.
"""

import os, tempfile, time
from marionette_driver.marionette import Marionette
BIN = os.path.join(os.getcwd(), "obj-aarch64-apple-darwin25.5.0",
                   "dist", "Cthulhu.app", "Contents", "MacOS", "Cthulhu")
_fixture_dir = tempfile.mkdtemp(prefix="cthulhu-pinfix-")
with open(os.path.join(_fixture_dir, "pinned.html"), "w") as _f:
    _f.write("<!doctype html><title>PinnedTestPage</title><h1>pinned test page</h1>\n")
_PIN_URL = "file://" + os.path.join(_fixture_dir, "pinned.html")

m = Marionette(bin=BIN, gecko_log="-", prefs={"marionette.log.level": "Error"},
               app_args=["-remote-allow-system-access", "-profile",
                         tempfile.mkdtemp(prefix="cthulhu-unload-")])
m.start_session()
fails = []
try:
    m.set_context("chrome")
    time.sleep(2)
    print("=====UNLOAD=====")

    # Build: 1 pinned real tab + 1 normal tab, plus the Home tab.
    m.execute_script("const PIN_URL = arguments[0];" + """
      const sp = Services.scriptSecurityManager.getSystemPrincipal();
      window._pin = gBrowser.addTab(PIN_URL, {triggeringPrincipal: sp});
      gBrowser.pinTab(window._pin);
      window._normal = gBrowser.addTab("about:robots", {triggeringPrincipal: sp});
      FirefoxViewHandler.openTab();   // creates the hidden Home tab
    """, script_args=(_PIN_URL,))
    time.sleep(4)

    print(m.execute_script("""
      const t = window._pin;
      return `setup: pinned tab loaded=${!!t.linkedPanel} pinned=${t.pinned}`
           + ` | tabs=${gBrowser.tabs.length} pinnedCount=${gBrowser.pinnedTabCount}`;
    """))

    # --- A. Cmd+W on a real pinned tab -> unloaded, not closed ---
    before = m.execute_script("""
      gBrowser.selectedTab = window._pin;
      return gBrowser.tabs.length;
    """)
    time.sleep(1)
    m.execute_script("""
      BrowserCommands.closeTabOrWindow({ ctrlKey: false, metaKey: true, altKey: false });
    """)
    time.sleep(3)   # the discard is deferred to TabSwitchDone on purpose
    r = m.execute_script("""
      const before = arguments[0];
      const t = window._pin;
      const survived = gBrowser.tabs.includes(t);
      const unloaded = !t.linkedPanel;
      const deselected = gBrowser.selectedTab !== t;
      return { before, after: gBrowser.tabs.length, survived, unloaded, deselected,
               discarded: t.hasAttribute("discarded"),
               pending: t.hasAttribute("pending"),
               url: t.linkedBrowser.currentURI.spec };
    """, script_args=(before,))
    ok = r["survived"] and r["unloaded"] and r["deselected"] and r["after"] == r["before"]
    if not ok: fails.append("A")
    print(f"A. pinned tab + Cmd/Ctrl+W -> survived={r['survived']} unloaded={r['unloaded']}"
          f" deselected={r['deselected']} tabs {r['before']}->{r['after']}"
          f" discarded={r['discarded']} pending={r['pending']}  {'[PASS]' if ok else '[FAIL]'}")
    print(f"   (url held by the unloaded tab: {r.get('url')})")

    # --- B. Home tab is exempt ---
    m.execute_script("FirefoxViewHandler.toggleHome();")
    time.sleep(2)
    r = m.execute_script("""
      const home = FirefoxViewHandler._homeTab;
      if (gBrowser.selectedTab !== home) { gBrowser.selectedTab = home; }
      const loadedBefore = !!home.linkedPanel;
      BrowserCommands.closeTabOrWindow({ ctrlKey: false, metaKey: true, altKey: false });
      return { loadedBefore, survived: gBrowser.tabs.includes(home),
               stillLoaded: !!home.linkedPanel,
               discarded: home.hasAttribute("discarded") };
    """)
    ok = r["survived"] and r["stillLoaded"] and not r["discarded"]
    if not ok: fails.append("B")
    print(f"B. HOME tab + Cmd/Ctrl+W -> survived={r['survived']} stillLoaded={r['stillLoaded']}"
          f" discarded={r['discarded']}  {'[PASS]' if ok else '[FAIL]'}")

    # --- C. normal tab still closes ---
    r = m.execute_script("""
      const t = window._normal;
      gBrowser.selectedTab = t;
      const before = gBrowser.tabs.length;
      BrowserCommands.closeTabOrWindow({ ctrlKey: false, metaKey: true, altKey: false });
      return { before, closing: t.closing, after: gBrowser.tabs.length };
    """)
    time.sleep(2)
    r2 = m.execute_script("return { after: gBrowser.tabs.length, gone: !gBrowser.tabs.includes(window._normal) };")
    r["gone"] = r2["gone"]; r["after"] = r2["after"]
    ok = (r["gone"] or r["closing"]) and r["after"] == r["before"] - 1
    if not ok: fails.append("C")
    print(f"C. normal tab + Cmd/Ctrl+W -> closed={r['gone']} tabs {r['before']}->{r['after']}"
          f"  {'[PASS]' if ok else '[FAIL]'}")

    # --- D. unloaded pinned tab reloads when selected again ---
    m.execute_script("gBrowser.selectedTab = window._pin;")
    time.sleep(4)   # the lazy restore is async: about:blank first, then the page
    r = m.execute_script("""
      const t = window._pin;
      return { url: t.linkedBrowser.currentURI.spec, reattached: !!t.linkedPanel };
    """)
    ok = r["reattached"] and "pinned.html" in r["url"]
    if not ok: fails.append("D")
    print(f"D. re-selecting the unloaded tab restores it -> {r['url']} reattached={r['reattached']}"
          f"  {'[PASS]' if ok else '[FAIL]'}")
    print(f"\nRESULT: {'ALL PASS' if not fails else 'FAILED: ' + ','.join(fails)}")
    print("=====END=====")
finally:
    m.quit()
