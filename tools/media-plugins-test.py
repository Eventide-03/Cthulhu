"""Check that Widevine (and OpenH264) actually install, so DRM sites play.

    cd engine && ./mach python ../tools/media-plugins-test.py

Firefox fetches its media plugins from aus5.mozilla.org with a URL carrying
%VERSION% -- Services.appinfo.version, which in Cthulhu is Cthulhu's own 1.0.x.
Mozilla's server picks plugins by Firefox version, answered "1.0.x" with an
empty list, and Widevine never installed: Netflix and every other DRM site sat
on "installing components needed to play the audio or video on this page" and
then called the browser unsupported. cthulhu.js now sends %PLATFORM_VERSION%.

This drives the REAL path against the real server, in a fresh profile: the URL
the browser builds, Mozilla's answer to it, an actual Widevine install, and the
call a DRM site makes before it plays anything -- requestMediaKeySystemAccess
for com.widevine.alpha, then createMediaKeys(), which starts the CDM.
Needs the network; downloads Widevine (~20 MB) from Google, exactly as a first
run of the browser does.
"""
import os, sys, time, tempfile, subprocess
from marionette_driver.marionette import Marionette

BIN = os.path.join(os.getcwd(), "obj-aarch64-apple-darwin25.5.0", "dist", "Cthulhu.app", "Contents", "MacOS", "Cthulhu")
subprocess.run([os.path.join(os.path.dirname(os.path.abspath(__file__)), "dev-actors.sh")], check=False)

m = Marionette(bin=BIN, gecko_log="-", prefs={"marionette.log.level": "Error"},
               app_args=["-remote-allow-system-access", "-profile", tempfile.mkdtemp(prefix="cthulhu-gmp-")])
m.start_session()
fails = []
def check(label, ok, extra=""):
    print(("PASS " if ok else "FAIL ") + label + ("  " + str(extra) if extra != "" else ""))
    if not ok: fails.append(label)
def chrome(js, *a):
    m.set_context("chrome"); return m.execute_script(js, script_args=a)
def chrome_async(js, *a):
    m.set_context("chrome"); return m.execute_async_script(js, script_args=a, script_timeout=180000)

try:
    print("=====MEDIA PLUGINS=====")
    info = chrome("""return { url: Services.prefs.getCharPref('media.gmp-manager.url'),
                              version: Services.appinfo.version, platform: Services.appinfo.platformVersion,
                              eme: Services.prefs.getBoolPref('media.eme.enabled') };""")
    check("the plugin URL asks by Firefox version (%PLATFORM_VERSION%), not Cthulhu's (%VERSION%)",
          "/GMP/%PLATFORM_VERSION%/" in info["url"] and "%VERSION%" not in info["url"], info["url"])

    url = chrome_async("""const done = arguments[arguments.length - 1];
      const { UpdateUtils } = ChromeUtils.importESModule('resource://gre/modules/UpdateUtils.sys.mjs');
      UpdateUtils.formatUpdateURL(Services.prefs.getCharPref('media.gmp-manager.url')).then(done, e => done('ERR ' + e));""")
    check("the URL the browser sends carries the Gecko version (%s), not %s" % (info["platform"], info["version"]),
          ("/GMP/%s/" % info["platform"]) in url, url)

    ads = chrome_async("""const done = arguments[arguments.length - 1];
      const { GMPInstallManager } = ChromeUtils.importESModule('resource://gre/modules/GMPInstallManager.sys.mjs');
      new GMPInstallManager().checkForAddons().then(
        r => done({ fallback: !!r.usedFallback, ids: r.addons.map(a => a.id + '@' + a.version) }),
        e => done({ err: String(e && (e.message || e.type) || e) }));""")
    check("Mozilla's server answers with Widevine and OpenH264 (not the empty list 1.0.x got)",
          ads and not ads.get("err") and any(i.startswith("gmp-widevinecdm@") for i in ads["ids"])
          and any(i.startswith("gmp-gmpopenh264@") for i in ads["ids"]) and not ads["fallback"], ads)

    inst = chrome_async("""const done = arguments[arguments.length - 1];
      const { GMPInstallManager } = ChromeUtils.importESModule('resource://gre/modules/GMPInstallManager.sys.mjs');
      Services.prefs.clearUserPref('media.gmp-manager.lastCheck');
      new GMPInstallManager().simpleCheckAndInstall().then(r => done({ status: r.status }), e => done({ err: String(e && (e.message || e.type) || e) }));""")
    wv = None
    for _ in range(90):
        wv = chrome("return Services.prefs.getCharPref('media.gmp-widevinecdm.version', '');")
        if wv: break
        time.sleep(2)
    check("Widevine actually installs into the profile", bool(wv), {"install": inst, "version": wv})

    # The call a DRM site makes first. Netflix needs exactly this to succeed.
    m.set_context("content")
    m.navigate("https://example.com/")
    eme = m.execute_async_script("""const done = arguments[arguments.length - 1];
      navigator.requestMediaKeySystemAccess('com.widevine.alpha', [{
        initDataTypes: ['cenc'],
        videoCapabilities: [{ contentType: 'video/mp4; codecs="avc1.42E01E"', robustness: '' }],
        audioCapabilities: [{ contentType: 'audio/mp4; codecs="mp4a.40.2"', robustness: '' }] }])
        .then(a => a.createMediaKeys().then(k => done({ keySystem: a.keySystem, mediaKeys: !!k })))
        .catch(e => done({ err: e.name + ': ' + e.message }));""", script_timeout=120000)
    check("a page gets Widevine: requestMediaKeySystemAccess resolves and createMediaKeys() starts the CDM",
          eme and eme.get("keySystem") == "com.widevine.alpha" and eme.get("mediaKeys"), eme)
finally:
    try: m.quit()
    except Exception: pass
print()
print(("FAILURES: " + ", ".join(fails)) if fails else "ALL PASS")
sys.exit(1 if fails else 0)
