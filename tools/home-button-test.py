"""End-to-end check of the Home button against the real local build (macOS).

    cd engine && ./mach python ../tools/home-button-test.py [--check-fxview-gone]

Launches the built app (dist/Firefox Nightly.app, the one `surfer run` uses; or $CTHULHU_BIN) with a throwaway
profile, drives it over Marionette, prints PASS/FAIL per check and exits
non-zero on any failure. Never touches your real profile. Run it after an ESR
rebase: it is the proof that src/browser/firefox-view-to-home.patch still does
what it claims -- button reaches Home, Home is never navigated away in place,
drop-to-pin works, and the pinned Home tab survives a quit/relaunch.

If a check that passed before starts failing right after a rebuild, refresh the
bundle first (see CONTRIBUTING.md): the .app keeps copied XUL/browser.xhtml
that `mach build` does not always re-copy.
"""
import os
import shutil
import socket
import subprocess
import sys
import tempfile
import time

sys.path.insert(0, os.path.join(os.getcwd(), "testing", "marionette", "client"))
from marionette_driver import By  # noqa: E402
from marionette_driver.marionette import Marionette  # noqa: E402

OBJ = next((d for d in sorted(os.listdir(".")) if d.startswith("obj-")), "obj-aarch64-apple-darwin25.5.0")
def _default_bin():
    # `surfer run` launches dist/Firefox Nightly.app (mach's configured bundle
    # name); `surfer build` writes dist/nightly.app. Prefer what surfer run uses.
    for bundle in ("Firefox Nightly.app", "nightly.app"):
        cand = os.path.join(os.getcwd(), OBJ, "dist", bundle, "Contents", "MacOS", "Cthulhu")
        if os.path.exists(cand):
            return cand
    return os.path.join(os.getcwd(), OBJ, "dist", "Firefox Nightly.app", "Contents", "MacOS", "Cthulhu")


BIN = os.environ.get("CTHULHU_BIN") or _default_bin()
PORT = 2829
HOME = "about:cthulhu#home"
CHECK_FXVIEW_GONE = "--check-fxview-gone" in sys.argv

USER_JS = f"""
user_pref("marionette.port", {PORT});
user_pref("browser.shell.checkDefaultBrowser", false);
user_pref("browser.startup.homepage_override.mstone", "ignore");
user_pref("startup.homepage_welcome_url", "");
user_pref("startup.homepage_welcome_url.additional", "");
user_pref("browser.aboutwelcome.enabled", false);
user_pref("app.update.disabledForTesting", true);
user_pref("datareporting.policy.dataSubmissionEnabled", false);
user_pref("cthulhu.ambient.weather.enabled", false);
user_pref("browser.tabs.warnOnClose", false);
user_pref("dom.disable_open_during_load", false);
"""

results = []


def check(name, cond, detail=""):
    results.append((name, bool(cond)))
    print(("  PASS  " if cond else "  FAIL  ") + name + (("  -- " + detail) if detail and not cond else ""))


def wait_port(port, timeout=120):
    end = time.time() + timeout
    while time.time() < end:
        with socket.socket() as s:
            s.settimeout(1)
            try:
                s.connect(("127.0.0.1", port))
                return True
            except OSError:
                time.sleep(0.5)
    return False


def wait_until(fn, timeout=10, step=0.2):
    end = time.time() + timeout
    last = None
    while time.time() < end:
        last = fn()
        if last:
            return last
        time.sleep(step)
    return last


profile = tempfile.mkdtemp(prefix="cthulhu-home-test-")
with open(os.path.join(profile, "user.js"), "w") as fh:
    fh.write(USER_JS)


def launch():
    env = dict(os.environ, MOZ_NO_REMOTE="1")
    p = subprocess.Popen(
        [BIN, "-marionette", "-remote-allow-system-access", "-profile", profile, "-no-remote", "-foreground"],
        env=env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
    )
    if not wait_port(PORT):
        print("FATAL: marionette port never opened"); p.kill(); sys.exit(2)
    c = Marionette(host="127.0.0.1", port=PORT, startup_timeout=120)
    c.start_session()
    c.set_context(c.CONTEXT_CHROME)
    time.sleep(2)  # let delayed startup + session restore settle
    return p, c


def focus_home_tab(c):
    """Marionette keeps its own notion of the current content window; changing
    gBrowser.selectedTab from chrome does not move it. Walk the handles and
    switch to the one whose document is the Home page."""
    c.set_context(c.CONTEXT_CONTENT)
    for h in c.window_handles:
        c.switch_to_window(h)
        try:
            if c.execute_script("return location.href") == HOME:
                return True
        except Exception:
            continue
    return False


def quit_app(p, c, force=False):
    try:
        c.set_context(c.CONTEXT_CHROME)
        c.execute_script("Services.startup.quit(arguments[0] ? Services.startup.eForceQuit : Services.startup.eAttemptQuit)", [force])
    except Exception:
        pass
    try:
        p.wait(timeout=20)
    except Exception:
        p.kill()
    # give the port a moment to close before any relaunch
    time.sleep(1.5)


client = None
proc = None
try:
    print("launching", BIN)
    proc, client = launch()
    js = client.execute_script

    # ---- 0. the handler is the Cthulhu one, started, and .tab is inert ----
    info = js("""
      return {
        started: !!FirefoxViewHandler._started,
        tabNull: FirefoxViewHandler.tab === null,
        hasHomeUrl: FirefoxViewHandler.HOME_URL,
        label: document.getElementById('firefox-view-button')?.getAttribute('label'),
        tooltip: document.getElementById('firefox-view-button')?.getAttribute('tooltiptext'),
        tabs: gBrowser.tabs.length,
      };""")
    check("handler replaced at source (HOME_URL present)", info["hasHomeUrl"] == HOME, str(info))
    check("handler started from browser-init.js", info["started"], str(info))
    check("FirefoxViewHandler.tab stays null (call sites inert)", info["tabNull"], str(info))
    check("button labelled Home", (info["label"] or "") == "Home", "label=%r tooltip=%r" % (info["label"], info["tooltip"]))
    print("     tooltip:", info["tooltip"], "| tabs at start:", info["tabs"])

    # ---- 1. click the button through the REAL toolbar path ----
    before = js("return gBrowser.selectedTab.linkedBrowser.currentURI.spec")
    client.find_element(By.ID, "firefox-view-button").click()
    state = wait_until(lambda: js("""
      const t = gBrowser.selectedTab;
      const ok = t.hasAttribute('cthulhu-home-tab') && t.pinned &&
                 t.linkedBrowser.currentURI.spec === arguments[0];
      return ok ? { url: t.linkedBrowser.currentURI.spec, pinned: t.pinned,
                    open: document.getElementById('firefox-view-button').hasAttribute('open'),
                    fxview: gBrowser.tabs.some(x => x.linkedBrowser.currentURI.spec.startsWith('about:firefoxview')) } : null;
    """, [HOME]))
    check("click opens the pinned Home tab (not Firefox View)", bool(state), "selected=%s" % js("return gBrowser.selectedTab.linkedBrowser.currentURI.spec"))
    if state:
        check("no about:firefoxview tab exists", not state["fxview"])
        check("button shows pressed ([open]) while on Home", state["open"])
        check("Home tab is hidden from the strip (display:none)", js("""
          return getComputedStyle(gBrowser.selectedTab).display === 'none';"""))

    # ---- 2. click again -> back where you were (no debounce any more, so no gap needed) ----
    time.sleep(0.3)
    client.find_element(By.ID, "firefox-view-button").click()
    back = wait_until(lambda: js("""
      return gBrowser.selectedTab.linkedBrowser.currentURI.spec === arguments[0] &&
             !gBrowser.selectedTab.hasAttribute('cthulhu-home-tab');""", [before]))
    check("second click toggles back to the previous tab", bool(back))
    check("button no longer [open]", not js("return document.getElementById('firefox-view-button').hasAttribute('open')"))
    check("still exactly one Home tab", js("return gBrowser.tabs.filter(t => t.hasAttribute('cthulhu-home-tab')).length") == 1)

    # ---- 3. guard: nothing may navigate Home away in place ----
    js("gBrowser.selectedTab = gBrowser.tabs.find(t => t.hasAttribute('cthulhu-home-tab'))")
    check("(setup) Home is the selected tab", js("return gBrowser.selectedTab.hasAttribute('cthulhu-home-tab')"))
    n0 = js("return gBrowser.tabs.length")
    # 3a. a chrome-initiated in-place load (what a typed URL / script would do)
    js("""
      const b = gBrowser.selectedTab.linkedBrowser;
      b.loadURI(Services.io.newURI('https://example.com/'), {
        triggeringPrincipal: Services.scriptSecurityManager.getSystemPrincipal() });""")
    r = wait_until(lambda: js("""
      const home = gBrowser.tabs.find(t => t.hasAttribute('cthulhu-home-tab'));
      const fresh = gBrowser.tabs.find(t => t !== home &&
        (t.linkedBrowser.currentURI.spec.startsWith('https://example.com') ||
         (t.linkedBrowser.userTypedValue||'').startsWith('https://example.com')));
      return (gBrowser.tabs.length > arguments[0] && home &&
              home.linkedBrowser.currentURI.spec === arguments[1]) ? {fresh: !!fresh} : null;""", [n0, HOME]), timeout=15)
    check("in-place load of Home is diverted: Home still about:cthulhu#home, new tab opened", bool(r),
          "tabs=%s selected=%s" % (js("return gBrowser.tabs.length"), js("return gBrowser.selectedTab.linkedBrowser.currentURI.spec")))
    # 3b. a CONTENT-initiated load from the page itself (location.href) -- the
    #     path a search used to take
    js("gBrowser.selectedTab = gBrowser.tabs.find(t => t.hasAttribute('cthulhu-home-tab'))")
    n1 = js("return gBrowser.tabs.length")
    check("(setup) Marionette content target is the Home page", focus_home_tab(client))
    try:
        client.execute_script("location.href = 'https://example.org/';")
    except Exception as e:  # navigation may tear the script context down; fine
        print("     (content script returned:", type(e).__name__, ")")
    client.set_context(client.CONTEXT_CHROME)
    r2 = wait_until(lambda: js("""
      const home = gBrowser.tabs.find(t => t.hasAttribute('cthulhu-home-tab'));
      return (home && home.linkedBrowser.currentURI.spec === arguments[1] &&
              gBrowser.tabs.length > arguments[0]) ? true : null;""", [n1, HOME]), timeout=15)
    check("content location.href from Home is diverted to a new tab, Home survives", bool(r2),
          "tabs=%s" % js("return gBrowser.tabs.map(t => (t.hasAttribute('cthulhu-home-tab') ? 'HOME:' : '') + t.linkedBrowser.currentURI.spec)"))

    # 3c. the search widget itself, if the default home layout has one
    js("gBrowser.selectedTab = gBrowser.tabs.find(t => t.hasAttribute('cthulhu-home-tab'))")
    focus_home_tab(client)
    has_search = client.execute_script("return !!document.querySelector('.cw-search input')")
    if has_search:
        client.set_context(client.CONTEXT_CHROME)
        n2 = js("return gBrowser.tabs.length")
        client.set_context(client.CONTEXT_CONTENT)
        client.execute_script("""
          const i = document.querySelector('.cw-search input'); i.value = 'cthulhu marionette';
          i.form.requestSubmit();""")
        client.set_context(client.CONTEXT_CHROME)
        r3 = wait_until(lambda: js("""
          const home = gBrowser.tabs.find(t => t.hasAttribute('cthulhu-home-tab'));
          return (home && home.linkedBrowser.currentURI.spec === arguments[1] &&
                  gBrowser.tabs.length > arguments[0]) ? true : null;""", [n2, HOME]), timeout=15)
        check("search widget submit opens a new tab and keeps Home", bool(r3))
    else:
        client.set_context(client.CONTEXT_CHROME)
        print("  SKIP  search widget not on the default home layout; covered by 3a/3b")

    # ---- 4. drop a tab on the button -> pinned ----
    pinned = js("""
      const home = gBrowser.tabs.find(t => t.hasAttribute('cthulhu-home-tab'));
      const victim = gBrowser.tabs.find(t => t !== home && !t.pinned);
      if (!victim) return { error: 'no unpinned tab to drop' };
      const wasPinned = victim.pinned;
      const dt = new DataTransfer();
      dt.mozSetDataAt(TAB_DROP_TYPE, victim, 0);
      const btn = document.getElementById('firefox-view-button');
      const over = new DragEvent('dragover', { dataTransfer: dt, bubbles: true, cancelable: true });
      btn.dispatchEvent(over);
      const drop = new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true });
      btn.dispatchEvent(drop);
      window.__victim = victim;
      return { wasPinned, overAccepted: over.defaultPrevented, dropHandled: drop.defaultPrevented,
               effect: dt.dropEffect, pinnedCountBefore: gBrowser.pinnedTabCount - (victim.pinned ? 1 : 0) };""")
    after = wait_until(lambda: js("""
      const v = window.__victim;
      return (v && v.pinned && gBrowser.tabs.includes(v)) ? { pinned: true, stillSameTab: true,
              pinnedCount: gBrowser.pinnedTabCount } : null;"""), timeout=3) or js("""
      const v = window.__victim; return { pinned: !!(v && v.pinned), stillSameTab: !!(v && gBrowser.tabs.includes(v)),
              pinnedCount: gBrowser.pinnedTabCount };""")
    pinned.update(after)
    check("dragover on the button is accepted for a tab drag", pinned.get("overAccepted"), str(pinned))
    check("drop on the button pins THE DROPPED tab (same tab, not a clone)", (not pinned.get("wasPinned")) and pinned.get("pinned") and pinned.get("stillSameTab"), str(pinned))
    check("drop sets dropEffect=move (so dragend won't detach into a new window)", pinned.get("effect") == "move", str(pinned))

    # ---- 5. about:firefoxview is gone (only meaningful after the C++ rebuild) ----
    if CHECK_FXVIEW_GONE:
        js("gBrowser.selectedTab = gBrowser.addTrustedTab('about:firefoxview')")
        gone = wait_until(lambda: js("""
          const b = gBrowser.selectedTab.linkedBrowser;
          const spec = b.currentURI.spec;
          const err = b.documentURI && b.documentURI.spec.startsWith('about:neterror');
          return (err || !spec.startsWith('about:firefoxview')) ? {spec, doc: b.documentURI && b.documentURI.spec} : null;
        """), timeout=10)
        check("about:firefoxview no longer resolves", bool(gone), str(js("return gBrowser.selectedTab.linkedBrowser.documentURI && gBrowser.selectedTab.linkedBrowser.documentURI.spec")))

    # ---- 6. no errors from our code in the console ----
    errs = js("""
      return Services.console.getMessageArray()
        .map(m => m.message || String(m))
        .filter(m => /Cthulhu Home|FirefoxViewHandler|cthulhu-home/.test(m) && /error|Error|TypeError|ReferenceError/.test(m));""")
    check("no console errors from the Home handler", not errs, "\n".join(errs)[:800])

    # ---- 7. RESTART: the pinned Home tab must come back adopted and hidden ----
    # Pinned tabs persist across restarts on their own; SessionStore recreates
    # the Home tab through its own path and knows nothing about our marker. The
    # old module's documented regression was exactly this: after relaunch the
    # restored tab sat visible in the strip beside the button, and the next
    # click created a second Home. Quit gracefully so the session is written.
    js("gBrowser.selectedTab = gBrowser.tabs.find(t => t.hasAttribute('cthulhu-home-tab'))")
    quit_app(proc, client, force=False)
    proc, client = launch()
    js = client.execute_script
    restored = wait_until(lambda: js("""
      const homes = gBrowser.tabs.filter(t => t.linkedBrowser.currentURI.spec === arguments[0]);
      if (homes.length !== 1) return null;
      const h = homes[0];
      return { adopted: FirefoxViewHandler._homeTab === h, marked: h.hasAttribute('cthulhu-home-tab'),
               pinned: h.pinned, hidden: getComputedStyle(h).display === 'none', tabs: gBrowser.tabs.length };""", [HOME]), timeout=15)
    check("after relaunch: exactly one Home tab exists", bool(restored), str(js("return gBrowser.tabs.map(t=>t.linkedBrowser.currentURI.spec)")))
    if restored:
        check("after relaunch: restored Home tab is adopted by the handler", restored["adopted"], str(restored))
        check("after relaunch: restored Home tab is pinned and hidden from the strip", restored["pinned"] and restored["hidden"], str(restored))
    client.find_element(By.ID, "firefox-view-button").click()
    check("after relaunch: clicking Home selects the restored tab (no duplicate created)", bool(wait_until(lambda: js("""
      return gBrowser.selectedTab.hasAttribute('cthulhu-home-tab') &&
             gBrowser.tabs.filter(t => t.hasAttribute('cthulhu-home-tab')).length === 1;"""))))

finally:
    if proc is not None:
        quit_app(proc, client, force=True)
    shutil.rmtree(profile, ignore_errors=True)

failed = [n for n, ok in results if not ok]
print("\n%d checks, %d failed" % (len(results), len(failed)))
sys.exit(1 if failed else 0)
