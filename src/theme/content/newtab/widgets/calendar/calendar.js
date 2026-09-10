/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/* Calendar widget (utility): a Notion-style month board on top of Google
 * Calendar -- several calendars at once.
 *
 *   - the whole month as a 7-column grid, one box per item on its day;
 *     an item spanning several days is ONE bar across them
 *   - press a day's "+"  ->  the item editor: name, which calendar, kind,
 *                            dates, all-day or a time, notes. Enter creates.
 *   - drag a box to another day                       ->  it moves
 *   - drag a box's left/right edge                    ->  it grows/shrinks
 *   - click a box's title                             ->  rename it in place
 *   - hover a box for ✓ (done), ✎ (edit) and × (delete -- one click)
 *   - Mine / Theirs / Both filter, ⟳, ‹ Today ›, and a 5-15 min poll
 *
 * CALENDARS AND SIDES. Every calendar the Google account can see is listed in
 * ⚙ with a role: Off, Mine, Theirs, or Shared. All calendars that are not Off
 * are loaded together, so a read-only school calendar and a personal one show
 * on one board while new items still go to the writable one. An item's side:
 *
 *     Mine    -> "mine"       (whoever created it)
 *     Theirs  -> "theirs"     (the other person's calendar, shared with you)
 *     Shared  -> by creator   (a calendar you both write to)
 *
 * The other person's calendars appear in your list once they share them with
 * your Google account (Google Calendar -> calendar Settings -> Share with
 * specific people); tag those Theirs. There is no other way for one account to
 * read another's calendar, so this widget does not pretend otherwise.
 *
 * Auth/API live in gcal.js next door (OAuth + PKCE + loopback redirect). The
 * widget loader only auto-loads `widgets/<id>/<id>.js`, so this file pulls its
 * sibling in itself. Every edit goes straight to Google (PATCH = partial, so
 * nothing else on the event is touched), with the board updated optimistically
 * first and reloaded if Google says no.
 *
 * DONE-STATE and the item KIND live in the event's `extendedProperties.shared`
 * rather than in the title, so ticking something off doesn't mangle the text
 * the other person sees in their own Google Calendar. `shared` (not `private`)
 * so both people see the same state.
 *
 * Every loaded event is stamped with the calendar it came from (`_cthCal`) and
 * a key of calendar + id (`_cthKey`): the same invite can appear in two
 * calendars with the SAME event id, so the id alone cannot address a box.
 *
 * The grid itself is drawn locally from the system clock, so it renders before
 * anything is connected -- just with no boxes on it. */
const CTH_GCAL_READY = (function () {
  if (window.CthulhuGCal) return Promise.resolve(window.CthulhuGCal);
  return new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = "chrome://cthulhu/content/newtab/widgets/calendar/gcal.js";
    s.onload = () => resolve(window.CthulhuGCal);
    s.onerror = () => reject(new Error("could not load gcal.js"));
    document.head.appendChild(s);
  });
})();

const CTH_DOW_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const CTH_MONTH_NAMES = ["January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December"];
/* Kinds are just a tag we stamp on the event; Google has no notion of them, so
 * anything created elsewhere simply shows no pill. Colours are theme tokens. */
const CTH_KINDS = [
  { id: "task", label: "Task", color: "var(--accent)" },
  { id: "deadline", label: "Deadline", color: "var(--notify)" },
  { id: "event", label: "Event", color: "var(--accent-hover)" },
  { id: "project", label: "Project", color: "var(--fg-muted)" },
];
const CTH_MODES = ["both", "me", "them"];
const CTH_ROLES = [
  { id: "off", label: "Off", title: "Not shown" },
  { id: "mine", label: "Mine", title: "Everything in it is mine" },
  { id: "theirs", label: "Theirs", title: "The other person's calendar, shared with me" },
  { id: "shared", label: "Shared", title: "We both write here: each item is credited to whoever created it" },
];
const CTH_DRAG_THRESHOLD = 4; // px of movement before a press becomes a drag
const CTH_CAL_LIST_TTL = 5 * 60 * 1000;

/* --- date helpers. All local-time: an all-day event's `date` is a bare
 * YYYY-MM-DD with no zone, so parsing it with `new Date(str)` would treat it as
 * UTC and slide it a day for anyone west of Greenwich. Build from components. */
function cthYmd(d) {
  const p = (n) => String(n).padStart(2, "0");
  return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate());
}
/** RFC3339 *without* a zone suffix -- paired with an explicit timeZone field so
 *  Google interprets it as local wall-clock time, not UTC. */
function cthLocalIso(d) {
  const p = (n) => String(n).padStart(2, "0");
  return cthYmd(d) + "T" + p(d.getHours()) + ":" + p(d.getMinutes()) + ":00";
}
function cthValidYmd(s) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s || "")) return false;
  const [y, m, d] = s.split("-").map(Number);
  const t = new Date(y, m - 1, d);
  return t.getFullYear() === y && t.getMonth() === m - 1 && t.getDate() === d;
}
function cthParseDateOnly(s) {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, m - 1, d);
}
function cthAddDays(ymd, n) {
  const d = cthParseDateOnly(ymd);
  d.setDate(d.getDate() + n);
  return cthYmd(d);
}
/** Whole days from a to b (b - a). Through UTC so a DST change can't make it
 *  23 or 25 hours and round the wrong way. */
function cthDayDiff(a, b) {
  const [ay, am, ad] = a.split("-").map(Number);
  const [by, bm, bd] = b.split("-").map(Number);
  return Math.round((Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad)) / 86400000);
}
function cthEventStart(ev) {
  if (ev.start && ev.start.dateTime) return new Date(ev.start.dateTime);
  if (ev.start && ev.start.date) return cthParseDateOnly(ev.start.date);
  return null;
}
function cthIsAllDay(ev) {
  return !!(ev.start && ev.start.date && !ev.start.dateTime);
}
/** First and last LOCAL day an event touches, inclusive, as YYYY-MM-DD. */
function cthEventSpan(ev) {
  const start = cthEventStart(ev);
  if (!start) return null;
  let end;
  if (cthIsAllDay(ev)) {
    // all-day `end.date` is EXCLUSIVE per the API
    end = ev.end && ev.end.date ? cthParseDateOnly(ev.end.date) : new Date(start);
    end.setDate(end.getDate() - 1);
  } else {
    end = ev.end && ev.end.dateTime ? new Date(ev.end.dateTime) : new Date(start);
    // A timed event ending exactly at midnight belongs to the day before.
    if (end > start && end.getHours() === 0 && end.getMinutes() === 0) end = new Date(end.getTime() - 1);
  }
  const first = cthYmd(start);
  let last = cthYmd(end);
  if (cthDayDiff(first, last) < 0) last = first; // malformed end before start
  return { first, last };
}
function cthTimeLabel(ev) {
  if (cthIsAllDay(ev)) return "";
  const d = cthEventStart(ev);
  if (!d) return "";
  return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}
/** "HH:MM" of a timed event's start, for the editor. */
function cthTimeHm(ev) {
  if (cthIsAllDay(ev)) return "";
  const d = cthEventStart(ev);
  if (!d) return "";
  return String(d.getHours()).padStart(2, "0") + ":" + String(d.getMinutes()).padStart(2, "0");
}
function cthDurationMin(ev) {
  if (cthIsAllDay(ev)) return 60;
  const s = cthEventStart(ev);
  const e = ev.end && ev.end.dateTime ? new Date(ev.end.dateTime) : null;
  return s && e && e > s ? Math.round((e - s) / 60000) : 60;
}
function cthShared(ev) {
  return (ev.extendedProperties && ev.extendedProperties.shared) || {};
}
function cthIsDone(ev) {
  return cthShared(ev).cthulhuDone === "1";
}
function cthKindOf(ev) {
  const id = cthShared(ev).cthulhuKind;
  return CTH_KINDS.find((k) => k.id === id) || null;
}
/** Whose is it? Google marks the authenticated user's own events with
 *  creator.self; fall back to comparing addresses for anything that omits it. */
function cthIsMine(ev, myEmail) {
  const c = ev.creator || {};
  if (c.self === true) return true;
  if (myEmail && c.email) return c.email.toLowerCase() === myEmail.toLowerCase();
  return false;
}

/** Per-calendar roles from the config -- { calendarKey: "mine"|"theirs"|"shared" },
 *  Off entries dropped. Migrates the old single `calendarId`: the primary
 *  calendar was "mine"; anything else was the shared calendar of the old
 *  two-person model, where sides came from the creator. */
function cthCalendarRoles(cfg) {
  const cals = cfg && cfg.calendars;
  if (cals && typeof cals === "object" && Object.keys(cals).length) {
    const out = {};
    for (const [k, v] of Object.entries(cals)) if (v && v !== "off") out[k] = v;
    return out;
  }
  const legacy = (cfg && cfg.calendarId) || "primary";
  return { [legacy]: legacy === "primary" ? "mine" : "shared" };
}
/** "mine" | "theirs" for an event, from its calendar's role (or the creator on
 *  a Shared calendar). A test may inject `_cthSide` directly. */
function cthSideOf(ev, roles, myEmail) {
  if (ev._cthSide) return ev._cthSide;
  const role = roles[ev._cthCal || "primary"] || "mine";
  if (role === "theirs") return "theirs";
  if (role === "shared") return cthIsMine(ev, myEmail) ? "mine" : "theirs";
  return "mine";
}
/** The key a calendar goes by in the config: "primary" for the account's own,
 *  else its id. "primary" is also what the API accepts as a calendarId. */
const cthCalKey = (c) => (c.primary ? "primary" : c.id);

/** The PATCH body that moves an event onto [first..last] (inclusive local
 *  days). All-day events move by date; timed events keep their wall-clock
 *  times and just change day, so "drag Tuesday 9am to Thursday" is Thursday
 *  9am. Also returns the same shape merged into a copy of the event, for the
 *  optimistic repaint. Exposed at module scope so it can be checked offline. */
function cthPatchForSpan(ev, first, last) {
  const patch = {};
  if (cthIsAllDay(ev)) {
    patch.start = { date: first };
    patch.end = { date: cthAddDays(last, 1) }; // exclusive
  } else {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const s0 = cthEventStart(ev);
    const e0 = ev.end && ev.end.dateTime ? new Date(ev.end.dateTime) : new Date(s0.getTime() + 3600000);
    const [fy, fm, fd] = first.split("-").map(Number);
    const [ly, lm, ld] = last.split("-").map(Number);
    const s1 = new Date(fy, fm - 1, fd, s0.getHours(), s0.getMinutes());
    let e1 = new Date(ly, lm - 1, ld, e0.getHours(), e0.getMinutes());
    // The end can't precede the start (resizing a 9-10am item onto one day
    // whose end time is earlier than its start would do that): keep the
    // original duration instead.
    if (e1 <= s1) e1 = new Date(s1.getTime() + Math.max(60000, e0 - s0));
    patch.start = { dateTime: cthLocalIso(s1), timeZone: tz };
    patch.end = { dateTime: cthLocalIso(e1), timeZone: tz };
  }
  return patch;
}

/* The calendar list (names, writability) is shared by every tile and the ⚙
 * panel, and changes rarely: cache it for a few minutes. */
let cthCalListCache = { at: 0, list: null, promise: null };
function cthListCalendars(GCal, force) {
  if (!force && cthCalListCache.list && Date.now() - cthCalListCache.at < CTH_CAL_LIST_TTL) {
    return Promise.resolve(cthCalListCache.list);
  }
  if (cthCalListCache.promise) return cthCalListCache.promise;
  cthCalListCache.promise = GCal.listCalendars()
    .then((list) => { cthCalListCache = { at: Date.now(), list, promise: null }; return list; })
    .catch((e) => { cthCalListCache.promise = null; throw e; });
  return cthCalListCache.promise;
}

CthulhuWidgets.register({
  id: "calendar",
  category: "utility",
  name: "Calendar",
  defaultSize: { w: 5, h: 4 },
  defaultConfig: {
    calendars: { primary: "mine" }, // calendarKey -> off | mine | theirs | shared
    createIn: "primary",            // where "+" puts new items
    mode: "both",
    theirLabel: "Theirs",
    showCompleted: false,
    pollMinutes: 5,
  },
  css: `
    .cw-cal { display:flex; flex-direction:column; height:100%; gap:4px; overflow:hidden;
              font-family:var(--font-pixel); font-size:1.05em; }
    .cw-cal-head { display:flex; align-items:center; gap:4px; flex:none; }
    .cw-cal-title { font-size:1.1em; color:var(--fg); margin-inline-end:auto; white-space:nowrap;
                    overflow:hidden; text-overflow:ellipsis; min-width:0; }
    .cw-cal-hbtn {
      flex:none; border:1px solid var(--border); background:var(--surface); color:var(--fg);
      border-radius:5px; cursor:pointer; font-family:var(--font-pixel); font-size:12px;
      padding:4px 7px; line-height:1;
    }
    .cw-cal-hbtn:hover { border-color:var(--accent); }
    .cw-cal-hbtn.mode { color:var(--accent); }

    .cw-cal-dows { display:grid; grid-template-columns:repeat(7, minmax(0,1fr)); flex:none; }
    .cw-cal-dow { font-size:.8em; color:var(--fg-muted); text-align:center; padding:2px 0; }
    .cw-cal-month { flex:1; min-height:0; overflow-y:auto; overflow-x:hidden; display:flex; flex-direction:column;
                    border-top:1px solid var(--border); }
    .cw-cal-week { display:grid; grid-template-columns:repeat(7, minmax(0,1fr)); flex:1 0 auto;
                   min-height:56px; border-bottom:1px solid var(--border); position:relative; }
    .cw-cal-day { position:relative; min-width:0; border-right:1px solid var(--border); padding:2px 3px;
                  display:flex; flex-direction:column; }
    .cw-cal-day:nth-child(7) { border-right:none; }
    .cw-cal-day.other .cw-cal-num { color:var(--fg-muted); opacity:.55; }
    .cw-cal-day.drop { background:color-mix(in srgb, var(--accent) 14%, transparent); }
    .cw-cal-num { align-self:flex-end; font-size:.88em; color:var(--fg); line-height:1; min-width:1.6em;
                  text-align:center; padding:3px 2px; border-radius:999px; }
    .cw-cal-day.today .cw-cal-num { background:var(--accent); color:var(--fg-on-accent); }
    .cw-cal-add {
      position:absolute; top:2px; left:2px; width:18px; height:18px; border-radius:4px; padding:0;
      border:1px solid var(--border); background:var(--surface); color:var(--fg-muted);
      font-size:13px; line-height:1; cursor:pointer; opacity:0; transition:opacity .12s;
    }
    .cw-cal-day:hover .cw-cal-add, .cw-cal-add:focus-visible { opacity:1; }
    .cw-cal-add:hover { color:var(--accent); border-color:var(--accent); }

    /* One box per item per week row. A multi-day item is one bar spanning its
     * columns; a bar that continues into the next/previous week loses the
     * rounded corner on that side. */
    .cw-cal-ev {
      position:relative; z-index:1; margin:1px 2px; height:40px; box-sizing:border-box; min-width:0;
      display:flex; flex-direction:column; justify-content:center; gap:1px; padding:2px 3px 2px 5px;
      border-radius:5px; background:var(--bg-elevated); border:1px solid var(--border);
      border-left:3px solid var(--kind, var(--fg-muted));
      color:var(--fg); font-size:.88em; cursor:grab; user-select:none; overflow:hidden;
    }
    .cw-cal-ev-main { display:flex; align-items:center; gap:4px; min-width:0; }
    .cw-cal-ev-sub { display:flex; align-items:center; gap:4px; min-width:0; min-height:1.3em; }
    .cw-cal-ev.theirs { border-style:dashed; border-left-style:solid; }
    .cw-cal-ev.done { opacity:.5; }
    .cw-cal-ev.done .cw-cal-ev-title { text-decoration:line-through; }
    .cw-cal-ev.ro { cursor:default; }
    .cw-cal-ev.dragging { opacity:.45; cursor:grabbing; }
    .cw-cal-ev.cont-l { border-top-left-radius:0; border-bottom-left-radius:0; border-left-width:1px; margin-left:0; }
    .cw-cal-ev.cont-r { border-top-right-radius:0; border-bottom-right-radius:0; margin-right:0; }
    .cw-cal-ev:hover { border-color:var(--accent); border-left-color:var(--kind, var(--accent)); }
    .cw-cal-ev-time { flex:none; color:var(--fg-muted); }
    .cw-cal-ev-title { flex:1; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
    .cw-cal-pill { flex:none; font-size:.85em; padding:0 4px; border-radius:999px; line-height:1.4;
                   background:color-mix(in srgb, var(--kind, var(--accent)) 28%, transparent); color:var(--fg); }
    .cw-cal-calpill { flex:none; font-size:.8em; color:var(--fg-muted); overflow:hidden; text-overflow:ellipsis;
                      white-space:nowrap; max-width:45%; }
    .cw-cal--narrow .cw-cal-pill, .cw-cal--narrow .cw-cal-ev-time, .cw-cal--narrow .cw-cal-calpill { display:none; }
    .cw-cal-ev-tools { display:none; flex:none; gap:1px; margin-inline-start:auto; }
    .cw-cal-ev:hover .cw-cal-ev-tools { display:flex; }
    .cw-cal-rbtn { flex:none; border:none; background:transparent; cursor:pointer; padding:0 2px;
                   color:var(--fg-muted); font-size:1em; line-height:1; font-family:inherit; }
    .cw-cal-rbtn:hover { color:var(--accent); }
    .cw-cal-rbtn.del:hover { color:var(--notify); }
    .cw-cal-rz { position:absolute; top:0; bottom:0; width:7px; cursor:ew-resize; z-index:2; }
    .cw-cal-rz.l { left:-1px; } .cw-cal-rz.r { right:-1px; }
    .cw-cal-ev-title input {
      box-sizing:border-box; width:100%; min-width:0; padding:1px 4px; background:var(--bg);
      border:1px solid var(--accent); border-radius:4px; color:var(--fg); font-family:var(--font-pixel);
      font-size:inherit; outline:none;
    }

    .cw-cal-foot { flex:none; font-size:.86em; color:var(--fg-muted); line-height:1.35; }
    .cw-cal-foot:empty { display:none; }
    .cw-cal-foot.err { color:var(--notify); word-break:break-word; font-size:.9em; }
    .cw-cal-foot b { color:var(--fg); font-weight:normal; }

    /* --- the item editor (a modal; same shell as the ⚙ panel) ---
     * The shell's own rule (.cthulhu-widget-config input[type="text"]) makes
     * every text input full-width at 12px; the selectors below out-rank it
     * (they repeat the type attribute) so the name can be big and the dates
     * can sit in a row instead of each taking a line of their own. */
    .cw-cal-ed { width:360px; gap:10px; }
    .cw-cal-ed [hidden] { display:none !important; }
    .cw-cal-ed input[type="text"].cw-cal-ed-name {
      width:100%; box-sizing:border-box; padding:8px 10px; background:var(--bg); border:1px solid var(--border);
      border-radius:8px; color:var(--fg); font-family:var(--font-pixel); font-size:16px; outline:none;
    }
    .cw-cal-ed input[type="text"].cw-cal-ed-name:focus { border-color:var(--accent); }
    .cw-cal-ed-name::placeholder { color:var(--fg-muted); }
    .cw-cal-ed-when { display:flex; align-items:center; gap:5px; flex-wrap:wrap; font-size:12px; color:var(--fg-muted); }
    .cw-cal-ed input[type="text"].cw-cal-ed-date {
      flex:none; width:7.4em; box-sizing:border-box; padding:4px 3px; background:var(--bg); border:1px solid var(--border);
      border-radius:4px; color:var(--fg); font-family:var(--font-pixel); font-size:12px; outline:none;
      font-variant-numeric:tabular-nums; text-align:center;
    }
    .cw-cal-ed input[type="text"].cw-cal-ed-date:focus { border-color:var(--accent); }
    .cw-cal-ed input[type="text"].cw-cal-ed-date.bad { border-color:var(--notify); }
    .cw-cal-ed-nudge {
      flex:none; width:18px; height:22px; padding:0; border:1px solid var(--border); border-radius:4px; background:var(--surface);
      color:var(--fg-muted); cursor:pointer; font-family:inherit; line-height:1; font-size:9px;
    }
    .cw-cal-ed-nudge:hover { color:var(--accent); border-color:var(--accent); }
    .cw-cal-ed input[type="text"].cw-cal-ed-time { width:4.4em; }
    .cw-cal-ed-when .cw-ui-row { flex:none; }
    .cw-cal-ed textarea {
      width:100%; box-sizing:border-box; min-height:64px; padding:6px 8px; background:var(--bg);
      border:1px solid var(--border); border-radius:6px; color:var(--fg); font-family:var(--font-pixel);
      font-size:12px; outline:none; resize:vertical;
    }
    .cw-cal-ed textarea:focus { border-color:var(--accent); }
    .cw-cal-ed-actions { display:flex; gap:8px; align-items:center; flex-wrap:wrap; }
    .cw-cal-ed-del { margin-inline-start:auto; color:var(--notify) !important; border-color:var(--notify) !important; }
    .cw-cal-ed-status { font-size:11px; color:var(--notify); min-height:1.2em; }

    /* --- ⚙: the calendar list with its roles --- */
    .cw-cal-calrow { display:flex; flex-direction:column; gap:4px; padding:6px 0; border-top:1px solid var(--border); }
    .cw-cal-calrow:first-of-type { border-top:none; padding-top:0; }
    .cw-cal-calname { font-size:12px; color:var(--fg); overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
    .cw-cal-calname small { color:var(--fg-muted); }
    .cw-cal-roles .cw-ui-choice-btn { padding:2px 7px; font-size:11px; }
  `,

  render(el, ctx) {
    /* NOTE: about:cthulhu runs with the system principal, and assigning
     * innerHTML there goes through Gecko's chrome-fragment sanitizer, which
     * DROPS interactive elements -- <button>, <input> and <select> are all
     * silently removed. So only inert structure goes through innerHTML; every
     * control is built with createElement. */
    el.innerHTML =
      '<div class="cw-cal">' +
        '<div class="cw-cal-head"><span class="cw-cal-title"></span></div>' +
        '<div class="cw-cal-dows"></div>' +
        '<div class="cw-cal-month"></div>' +
        '<div class="cw-cal-foot"></div>' +
      "</div>";
    const root = el.querySelector(".cw-cal");
    const head = el.querySelector(".cw-cal-head");
    const titleEl = el.querySelector(".cw-cal-title");
    const dows = el.querySelector(".cw-cal-dows");
    const month = el.querySelector(".cw-cal-month");
    const foot = el.querySelector(".cw-cal-foot");
    for (const n of CTH_DOW_NAMES) {
      const d = document.createElement("div");
      d.className = "cw-cal-dow";
      d.textContent = n;
      dows.appendChild(d);
    }

    const mkHeadBtn = (cls, text, title) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "cw-cal-hbtn " + cls;
      b.textContent = text;
      b.title = title;
      head.appendChild(b);
      return b;
    };
    const modeBtn = mkHeadBtn("mode", "", "Whose items to show");
    const refreshBtn = mkHeadBtn("refresh", "⟳", "Refresh now");
    const prevBtn = mkHeadBtn("prev", "‹", "Previous month");
    const todayBtn = mkHeadBtn("today", "Today", "Back to this month");
    const nextBtn = mkHeadBtn("next", "›", "Next month");

    let disposed = false;
    let myEmail = null;
    let lastEvents = [];
    let connected = false;
    let calendars = null; // [{id, summary, primary, canWrite}] once Google has answered
    const roles = cthCalendarRoles(ctx.config);
    const now0 = new Date();
    let view = { y: now0.getFullYear(), m: now0.getMonth() };
    ctx.onCleanup(() => { disposed = true; });

    const setFoot = (html, isErr) => {
      foot.innerHTML = html || "";
      foot.classList.toggle("err", !!isErr);
    };
    const toast = (t) => { try { ctx.ui.toast(t); } catch (e) {} };
    const calOf = (key) => (calendars || []).find((c) => cthCalKey(c) === key) || null;
    const calName = (key) => { const c = calOf(key); return c ? c.summary : (key === "primary" ? "Primary" : key); };
    // Unknown until the list arrives: assume writable, and let Google say no.
    const writable = (key) => { const c = calOf(key); return c ? !!c.canWrite : true; };
    /** Calendars new items may go to: not Off, and writable. */
    const writableKeys = () => Object.keys(roles).filter(writable);
    const createKey = () => {
      const want = ctx.config.createIn || "primary";
      if (roles[want] && writable(want)) return want;
      return writableKeys()[0] || null;
    };

    const modeLabel = () => {
      const m = ctx.config.mode || "both";
      if (m === "me") return "Mine";
      if (m === "them") return ctx.config.theirLabel || "Theirs";
      return "Both";
    };
    modeBtn.textContent = modeLabel();
    modeBtn.addEventListener("click", () => {
      const i = CTH_MODES.indexOf(ctx.config.mode || "both");
      ctx.saveConfig({ ...ctx.config, mode: CTH_MODES[(i + 1) % CTH_MODES.length] }, { refresh: true });
    });
    refreshBtn.addEventListener("click", () => load(true));
    prevBtn.addEventListener("click", () => { shiftMonth(-1); });
    nextBtn.addEventListener("click", () => { shiftMonth(1); });
    todayBtn.addEventListener("click", () => {
      const n = new Date();
      view = { y: n.getFullYear(), m: n.getMonth() };
      paint();
      load();
    });
    function shiftMonth(d) {
      const t = new Date(view.y, view.m + d, 1);
      view = { y: t.getFullYear(), m: t.getMonth() };
      paint();
      load();
    }

    // The pill and the time label are the first things to go when a column is
    // only a few characters wide.
    if (typeof ResizeObserver === "function") {
      const ro = new ResizeObserver(() => {
        if (!disposed) root.classList.toggle("cw-cal--narrow", root.clientWidth < 420);
      });
      ro.observe(root);
      ctx.onCleanup(() => ro.disconnect());
    }

    const sideOf = (ev) => cthSideOf(ev, roles, myEmail);
    function applyMode(events) {
      const mode = ctx.config.mode || "both";
      let out = events;
      if (mode === "me") out = events.filter((ev) => sideOf(ev) === "mine");
      else if (mode === "them") out = events.filter((ev) => sideOf(ev) === "theirs");
      if (!ctx.config.showCompleted) out = out.filter((ev) => !cthIsDone(ev));
      return out;
    }

    /* --- the visible window: whole weeks, Sunday-first, covering the month --- */
    function visibleRange() {
      const first = new Date(view.y, view.m, 1);
      const start = new Date(view.y, view.m, 1 - first.getDay());
      const lastOfMonth = new Date(view.y, view.m + 1, 0);
      const weeks = Math.ceil((first.getDay() + lastOfMonth.getDate()) / 7);
      const endExcl = new Date(start.getFullYear(), start.getMonth(), start.getDate() + weeks * 7);
      return { start, endExcl, weeks };
    }

    /* --- paint: pure function of (view, lastEvents) --- */
    function paint() {
      if (disposed) return;
      titleEl.textContent = CTH_MONTH_NAMES[view.m] + " " + view.y;
      const { start, weeks } = visibleRange();
      const todayKey = cthYmd(new Date());
      const events = applyMode(lastEvents)
        .map((ev) => ({ ev, span: cthEventSpan(ev) }))
        .filter((x) => x.span)
        .sort((a, b) => {
          const d = cthDayDiff(b.span.first, a.span.first); // earlier start first
          if (d) return d;
          return cthDayDiff(a.span.last, b.span.last);       // then the longer one first
        });

      month.innerHTML = "";
      for (let w = 0; w < weeks; w++) {
        const weekStart = cthYmd(new Date(start.getFullYear(), start.getMonth(), start.getDate() + w * 7));
        const weekEnd = cthAddDays(weekStart, 6);
        const week = document.createElement("div");
        week.className = "cw-cal-week";

        // Segments of every event that touches this week, packed into lanes:
        // first lane whose 7 columns are free over the segment's span.
        const lanes = []; // lanes[i] = Array(7) of booleans
        const segs = [];
        for (const { ev, span } of events) {
          if (cthDayDiff(span.last, weekStart) > 0 || cthDayDiff(weekEnd, span.first) > 0) continue;
          const s = Math.max(0, cthDayDiff(weekStart, span.first));
          const e = Math.min(6, cthDayDiff(weekStart, span.last));
          let lane = 0;
          for (;; lane++) {
            if (!lanes[lane]) lanes[lane] = new Array(7).fill(false);
            let free = true;
            for (let c = s; c <= e; c++) if (lanes[lane][c]) { free = false; break; }
            if (free) { for (let c = s; c <= e; c++) lanes[lane][c] = true; break; }
          }
          segs.push({ ev, span, s, e, lane,
            contL: cthDayDiff(span.first, weekStart) > 0,
            contR: cthDayDiff(weekEnd, span.last) > 0 });
        }
        const L = lanes.length;
        week.style.gridTemplateRows = "20px" + (L ? " repeat(" + L + ", 42px)" : "") + " minmax(8px, 1fr)";

        for (let c = 0; c < 7; c++) {
          const ymd = cthAddDays(weekStart, c);
          const d = cthParseDateOnly(ymd);
          const cell = document.createElement("div");
          cell.className = "cw-cal-day" +
            (d.getMonth() !== view.m ? " other" : "") +
            (ymd === todayKey ? " today" : "");
          cell.dataset.ymd = ymd;
          cell.style.gridColumn = String(c + 1);
          cell.style.gridRow = "1 / span " + (L + 2);
          const num = document.createElement("span");
          num.className = "cw-cal-num";
          num.textContent = String(d.getDate());
          cell.appendChild(num);
          const add = document.createElement("button");
          add.type = "button";
          add.className = "cw-cal-add";
          add.textContent = "+";
          add.title = "New item on " + ymd;
          add.setAttribute("aria-label", add.title);
          add.setAttribute("data-cthulhu-nodrag", "");
          add.addEventListener("pointerdown", (e) => e.stopPropagation());
          add.addEventListener("click", (e) => { e.stopPropagation(); beginCreate(ymd); });
          cell.appendChild(add);
          week.appendChild(cell);
        }
        for (const seg of segs) week.appendChild(renderSegment(seg));
        month.appendChild(week);
      }
    }

    function renderSegment(seg) {
      const { ev, span } = seg;
      const box = document.createElement("div");
      const kind = cthKindOf(ev);
      const ro = !writable(ev._cthCal || "primary");
      const theirs = sideOf(ev) === "theirs";
      box.className = "cw-cal-ev" +
        (cthIsDone(ev) ? " done" : "") +
        (seg.contL ? " cont-l" : "") + (seg.contR ? " cont-r" : "") +
        ((ctx.config.mode || "both") === "both" && theirs ? " theirs" : "") +
        (ro ? " ro" : "");
      if (kind) box.style.setProperty("--kind", kind.color);
      box.style.gridColumn = (seg.s + 1) + " / " + (seg.e + 2);
      box.style.gridRow = String(seg.lane + 2);
      box.dataset.eventId = ev.id;
      box.dataset.key = ev._cthKey || ev.id;
      box.dataset.cal = ev._cthCal || "primary";
      box.dataset.side = theirs ? "theirs" : "mine";
      const time = cthTimeLabel(ev);
      const multiCal = Object.keys(roles).length > 1;
      box.title = (ev.summary || "(no title)") +
        (time ? "\n" + time : "") +
        (span.first === span.last ? "" : "\n" + span.first + " → " + span.last) +
        "\n" + calName(ev._cthCal || "primary") + (ro ? " (read only)" : "") +
        (ev.description ? "\n\n" + ev.description : "") +
        (ro ? "" : "\nDrag to move · drag an edge to resize · click the name to rename");

      // Two lines, as on a Notion board: the name, then the time and the tag.
      const main = document.createElement("span");
      main.className = "cw-cal-ev-main";
      const title = document.createElement("span");
      title.className = "cw-cal-ev-title";
      title.textContent = ev.summary || "(no title)";
      main.appendChild(title);
      box.appendChild(main);
      const sub = document.createElement("span");
      sub.className = "cw-cal-ev-sub";
      if (time && !seg.contL) {
        const t = document.createElement("span");
        t.className = "cw-cal-ev-time";
        t.textContent = time;
        sub.appendChild(t);
      }
      if (kind) {
        const pill = document.createElement("span");
        pill.className = "cw-cal-pill";
        pill.textContent = kind.label;
        sub.appendChild(pill);
      }
      // With several calendars on the board, say which one a box came from.
      if (multiCal && !seg.contL) {
        const cp = document.createElement("span");
        cp.className = "cw-cal-calpill";
        cp.textContent = calName(ev._cthCal || "primary");
        sub.appendChild(cp);
      }
      box.appendChild(sub);

      if (!ro) {
        const tools = document.createElement("span");
        tools.className = "cw-cal-ev-tools";
        const mkTool = (cls, text, title, fn) => {
          const b = document.createElement("button");
          b.type = "button";
          b.className = "cw-cal-rbtn " + cls;
          b.textContent = text;
          b.title = title;
          b.addEventListener("pointerdown", (e) => e.stopPropagation());
          b.addEventListener("click", (e) => { e.stopPropagation(); fn(); });
          tools.appendChild(b);
          return b;
        };
        mkTool("done", cthIsDone(ev) ? "↺" : "✓", cthIsDone(ev) ? "Mark not done" : "Mark done", () => toggleDone(ev));
        mkTool("edit", "✎", "Edit", () => openEditor({ ev }));
        // One click. It goes to the calendar's trash on Google's side, where
        // it can be restored for 30 days -- so no "sure?" step here.
        mkTool("del", "×", "Delete", () => removeEvent(ev));
        main.appendChild(tools);

        // Resize handles only where the item really starts / ends.
        if (!seg.contL) box.appendChild(mkHandle("l"));
        if (!seg.contR) box.appendChild(mkHandle("r"));
        wireDrag(box, seg, title);
      } else {
        // A read-only calendar's box is still a box on the board -- it just
        // cannot be picked up. GridStack must not treat the press as a tile
        // drag either.
        box.setAttribute("data-cthulhu-nodrag", "");
        box.addEventListener("mousedown", (e) => e.stopPropagation());
        box.addEventListener("pointerdown", (e) => e.stopPropagation());
      }
      return box;
    }
    function mkHandle(side) {
      const h = document.createElement("span");
      h.className = "cw-cal-rz " + side;
      h.dataset.side = side;
      h.title = side === "l" ? "Drag to change the start" : "Drag to change the end";
      return h;
    }

    /* --- pointer interaction: move, resize, rename ---------------------------
     * Everything hangs off ONE pointerdown on the box with pointer capture, so
     * the tile underneath (GridStack) never sees the press and can't start a
     * widget drag from it. */
    // elementFromPoint would return the box under the pointer -- usually the
    // very box being dragged -- so find the day cell by geometry instead.
    function dayAt(x, y) {
      for (const cell of month.querySelectorAll(".cw-cal-day")) {
        const r = cell.getBoundingClientRect();
        if (x >= r.left && x < r.right && y >= r.top && y < r.bottom) return cell;
      }
      return null;
    }
    function clearDrop() {
      for (const c of month.querySelectorAll(".cw-cal-day.drop")) c.classList.remove("drop");
    }
    function wireDrag(box, seg, titleEl_) {
      // GridStack begins a TILE drag on mousedown; the box opts out of that via
      // the data-cthulhu-nodrag attribute (see newtab.js draggable.cancel) and,
      // belt and braces, by stopping the press here.
      box.setAttribute("data-cthulhu-nodrag", "");
      box.addEventListener("mousedown", (e) => e.stopPropagation());
      box.addEventListener("pointerdown", (e) => {
        if (e.button !== 0) return;
        e.stopPropagation(); // not a tile drag
        const handle = e.target.closest && e.target.closest(".cw-cal-rz");
        const mode = handle ? "resize-" + handle.dataset.side : "move";
        // Once the pointer is captured every event is retargeted to the box,
        // so whether this press began on the title must be decided now.
        const onTitle = titleEl_.contains(e.target);
        const originCell = dayAt(e.clientX, e.clientY);
        const origin = originCell ? originCell.dataset.ymd : seg.span.first;
        const startX = e.clientX;
        const startY = e.clientY;
        let dragging = false;
        let target = null;
        box.setPointerCapture(e.pointerId);

        const onMove = (ev2) => {
          if (!dragging) {
            if (Math.abs(ev2.clientX - startX) < CTH_DRAG_THRESHOLD &&
                Math.abs(ev2.clientY - startY) < CTH_DRAG_THRESHOLD) return;
            dragging = true;
            box.classList.add("dragging");
          }
          const cell = dayAt(ev2.clientX, ev2.clientY);
          const ymd = cell ? cell.dataset.ymd : null;
          if (ymd !== target) {
            target = ymd;
            clearDrop();
            if (cell) cell.classList.add("drop");
          }
        };
        const onUp = (ev2) => {
          box.removeEventListener("pointermove", onMove);
          box.removeEventListener("pointerup", onUp);
          box.removeEventListener("pointercancel", onUp);
          try { box.releasePointerCapture(e.pointerId); } catch (err) {}
          box.classList.remove("dragging");
          clearDrop();
          if (!dragging) {
            // A press that never moved: on the title it's a rename.
            if (ev2.type === "pointerup" && onTitle) beginRename(seg.ev, box, titleEl_);
            return;
          }
          if (!target || target === origin) return;
          const { first, last } = seg.span;
          if (mode === "move") {
            const delta = cthDayDiff(origin, target);
            moveEvent(seg.ev, cthAddDays(first, delta), cthAddDays(last, delta));
          } else if (mode === "resize-r") {
            moveEvent(seg.ev, first, cthDayDiff(first, target) < 0 ? first : target);
          } else {
            moveEvent(seg.ev, cthDayDiff(target, last) < 0 ? last : target, last);
          }
        };
        box.addEventListener("pointermove", onMove);
        box.addEventListener("pointerup", onUp);
        box.addEventListener("pointercancel", onUp);
      });
    }

    function beginRename(ev, box, titleEl_) {
      if (titleEl_.querySelector("input")) return;
      const old = ev.summary || "";
      const inp = document.createElement("input");
      inp.type = "text";
      inp.value = old;
      inp.setAttribute("aria-label", "Rename item");
      titleEl_.textContent = "";
      titleEl_.appendChild(inp);
      box.style.cursor = "text";
      let done = false;
      const finish = (commit) => {
        if (done) return;
        done = true;
        const text = inp.value.trim();
        box.style.cursor = "";
        if (commit && text && text !== old) renameEvent(ev, text);
        else paint();
      };
      inp.addEventListener("pointerdown", (e) => e.stopPropagation());
      inp.addEventListener("keydown", (e) => {
        if (e.key === "Enter") { e.preventDefault(); finish(true); }
        if (e.key === "Escape") { e.preventDefault(); finish(false); }
      });
      inp.addEventListener("blur", () => finish(true));
      inp.focus();
      inp.select();
    }

    /* --- the item editor -------------------------------------------------------
     * One modal for "new item on this day" and "edit this item": the name
     * first (focused, Enter submits), then which calendar it lives in, its
     * kind, the dates, all-day or a time, and notes. Same shell as the ⚙
     * panel. Dates are typed (YYYY-MM-DD, with ◀ ▶ to step a day): a native
     * date picker on this page is a chrome-level popup whose pick never comes
     * back, the same fault a <select> has here. */
    function openEditor(o) {
      const editing = !!(o && o.ev);
      const ev = editing ? o.ev : null;
      if (document.querySelector(".cw-cal-ed-modal")) return;
      const keys = writableKeys();
      if (!editing && !keys.length) {
        toast(calendars ? "Every calendar on this board is read-only. Turn a writable one on in ⚙." : "Connect Google Calendar in ⚙ first.");
        return;
      }

      const overlay = document.createElement("div");
      overlay.className = "cthulhu-config-modal cw-cal-ed-modal";
      const panel = document.createElement("div");
      panel.className = "cthulhu-widget-config cw-cal-ed";
      panel.setAttribute("role", "dialog");
      panel.setAttribute("aria-label", editing ? "Edit item" : "New item");
      overlay.appendChild(panel);
      const h = document.createElement("h3");
      h.className = "cthulhu-config-title";
      h.textContent = editing ? "Edit item" : "New item";
      panel.appendChild(h);

      const form = {
        summary: editing ? (ev.summary || "") : "",
        cal: editing ? (ev._cthCal || "primary") : createKey(),
        kind: editing ? ((cthKindOf(ev) || CTH_KINDS[0]).id) : "task",
        date: editing ? cthEventSpan(ev).first : o.date,
        endDate: editing ? cthEventSpan(ev).last : o.date,
        allDay: editing ? cthIsAllDay(ev) : true,
        time: editing ? (cthTimeHm(ev) || "09:00") : "09:00",
        durationMin: editing ? cthDurationMin(ev) : 60,
        notes: editing ? (ev.description || "") : "",
      };

      const name = document.createElement("input");
      name.type = "text";
      name.className = "cw-cal-ed-name";
      name.placeholder = "Name";
      name.value = form.summary;
      name.setAttribute("aria-label", "Item name");
      panel.appendChild(name);

      // Calendar. For a new item: the writable ones that are on. For an
      // existing item: those plus its own (moving it is a real move).
      const calOpts = [...new Set([...(editing ? [form.cal] : []), ...keys])]
        .map((k) => ({ value: k, label: calName(k) + (writable(k) ? "" : " — read only") }));
      if (calOpts.length) {
        panel.appendChild(ctx.ui.selectRow("Calendar", calOpts, form.cal, (v) => { form.cal = v; },
          { stack: calOpts.length > 2 || calOpts.some((c) => c.label.length > 14) }));
      }
      panel.appendChild(ctx.ui.selectRow("Kind", CTH_KINDS.map((k) => ({ value: k.id, label: k.label })), form.kind,
        (v) => { form.kind = v; }));

      // When: start [◀ ▶] to end [◀ ▶]; all-day, else a time + duration.
      const when = ctx.ui.field("When");
      const row = document.createElement("div");
      row.className = "cw-cal-ed-when";
      const dateBox = (key, label) => {
        const inp = document.createElement("input");
        inp.type = "text";
        inp.className = "cw-cal-ed-date";
        inp.placeholder = "YYYY-MM-DD";
        inp.value = form[key];
        inp.setAttribute("aria-label", label);
        inp.spellcheck = false;
        const commit = () => {
          const v = inp.value.trim();
          const ok = cthValidYmd(v);
          inp.classList.toggle("bad", !ok);
          if (ok) form[key] = v;
        };
        inp.addEventListener("input", commit);
        const nudge = (dir) => {
          const b = document.createElement("button");
          b.type = "button";
          b.className = "cw-cal-ed-nudge";
          b.textContent = dir < 0 ? "◀" : "▶";
          b.title = dir < 0 ? "A day earlier" : "A day later";
          b.addEventListener("click", (e) => {
            e.stopPropagation();
            if (!cthValidYmd(form[key])) return;
            form[key] = cthAddDays(form[key], dir);
            inp.value = form[key];
            inp.classList.remove("bad");
          });
          return b;
        };
        return { inp, prev: nudge(-1), next: nudge(1) };
      };
      const sd = dateBox("date", "Start date");
      const ed = dateBox("endDate", "End date");
      const to = document.createElement("span");
      to.textContent = "to";
      row.append(sd.prev, sd.inp, sd.next, to, ed.prev, ed.inp, ed.next);
      when.appendChild(row);

      const timeRow = document.createElement("div");
      timeRow.className = "cw-cal-ed-when";
      const allDayBox = ctx.ui.checkRow("All day", form.allDay, (v) => { form.allDay = v; paintTime(); });
      const timeInp = document.createElement("input");
      timeInp.type = "text";
      timeInp.className = "cw-cal-ed-date cw-cal-ed-time";
      timeInp.placeholder = "09:00";
      timeInp.value = form.time;
      timeInp.setAttribute("aria-label", "Start time");
      timeInp.addEventListener("input", () => {
        const ok = /^([01]?\d|2[0-3]):[0-5]\d$/.test(timeInp.value.trim());
        timeInp.classList.toggle("bad", !ok);
        if (ok) form.time = timeInp.value.trim();
      });
      const durRow = ctx.ui.selectRow("for",
        [30, 60, 90, 120].map((m) => ({ value: m, label: m < 60 ? m + "m" : (m / 60) + "h" })),
        [30, 60, 90, 120].includes(form.durationMin) ? form.durationMin : 60,
        (v) => { form.durationMin = parseInt(v, 10); });
      const at = document.createElement("span");
      at.textContent = "at";
      timeRow.append(allDayBox, at, timeInp, durRow);
      when.appendChild(timeRow);
      const paintTime = () => {
        at.hidden = timeInp.hidden = durRow.hidden = !!form.allDay;
      };
      paintTime();
      panel.appendChild(when);

      const notes = document.createElement("textarea");
      notes.placeholder = "Notes (optional)";
      notes.value = form.notes;
      notes.setAttribute("aria-label", "Notes");
      panel.appendChild(notes);

      const status = document.createElement("div");
      status.className = "cw-cal-ed-status";
      panel.appendChild(status);

      const actions = document.createElement("div");
      actions.className = "cw-cal-ed-actions";
      const okBtn = document.createElement("button");
      okBtn.type = "button";
      okBtn.className = "cw-cfg-save";
      okBtn.textContent = editing ? "Save" : "Create";
      const cancel = document.createElement("button");
      cancel.type = "button";
      cancel.className = "cw-ui-btn";
      cancel.textContent = "Cancel";
      actions.append(okBtn, cancel);
      if (editing) {
        const del = document.createElement("button");
        del.type = "button";
        del.className = "cw-ui-btn cw-cal-ed-del";
        del.textContent = "Delete";
        del.addEventListener("click", () => { close(); removeEvent(ev); });
        actions.appendChild(del);
      }
      panel.appendChild(actions);

      const close = () => overlay.remove();
      const submit = () => {
        form.summary = name.value.trim();
        form.notes = notes.value;
        if (!form.summary) { status.textContent = "Give it a name."; name.focus(); return; }
        if (!cthValidYmd(form.date)) { status.textContent = "The start date needs to be YYYY-MM-DD."; sd.inp.focus(); return; }
        if (!cthValidYmd(form.endDate) || cthDayDiff(form.date, form.endDate) < 0) form.endDate = form.date;
        if (!form.allDay && !/^([01]?\d|2[0-3]):[0-5]\d$/.test(form.time)) { status.textContent = "The time needs to be HH:MM."; timeInp.focus(); return; }
        if (!form.cal) { status.textContent = "Pick a calendar."; return; }
        close();
        if (editing) saveEdit(ev, form); else finishCreate(form);
      };
      okBtn.addEventListener("click", submit);
      cancel.addEventListener("click", close);
      overlay.addEventListener("click", (e) => { if (e.target === overlay) close(); });
      panel.addEventListener("keydown", (e) => {
        if (e.key === "Escape") { e.preventDefault(); close(); }
        if (e.key === "Enter" && e.target === name) { e.preventDefault(); submit(); }
        if ((e.ctrlKey || e.metaKey) && e.key === "Enter") { e.preventDefault(); submit(); }
      });
      document.body.appendChild(overlay);
      name.focus();
      if (editing) name.select();
      return overlay;
    }

    /* --- create / edit --------------------------------------------------------- */
    function beginCreate(ymd) {
      if (!connected) { toast("Connect Google Calendar in ⚙ first."); return; }
      openEditor({ date: ymd });
    }
    async function finishCreate(form) {
      const body = cthBuildEventBody(form);
      const cal = form.cal;
      // Optimistic: show it now with a placeholder id, then swap in the real one.
      const temp = { id: "tmp-" + Date.now(), ...body, creator: { self: true }, _cthCal: cal, _cthKey: cal + "|tmp-" + Date.now() };
      lastEvents = lastEvents.concat([temp]);
      paint();
      await withGCal(async (GCal) => {
        const made = await GCal.createEvent(cal, body);
        made._cthCal = cal;
        made._cthKey = cal + "|" + made.id;
        lastEvents = lastEvents.map((e) => (e._cthKey === temp._cthKey ? made : e));
        paint();
      }, async (m) => { toast("Could not create: " + m); await load(); });
    }
    async function saveEdit(ev, form) {
      const built = cthBuildEventBody(form);
      const patch = {
        summary: form.summary,
        description: form.notes || "",
        start: built.start,
        end: built.end,
        extendedProperties: { shared: { cthulhuKind: form.kind } },
      };
      const from = ev._cthCal || "primary";
      const to = form.cal || from;
      patchLocal(ev._cthKey, { ...patch, extendedProperties: { shared: { ...cthShared(ev), cthulhuKind: form.kind } },
        _cthCal: to, _cthKey: to + "|" + ev.id });
      await withGCal(async (GCal) => {
        if (to !== from) await GCal.moveEvent(from, ev.id, to);
        await GCal.patchEvent(to, ev.id, patch);
      }, async (m) => { toast("Could not save: " + m); await load(); });
    }

    /* --- mutations (optimistic; reload on failure) --------------------------- */
    async function withGCal(fn, onErr) {
      try {
        const GCal = await CTH_GCAL_READY;
        return await fn(GCal);
      } catch (e) {
        if (!disposed) (onErr || ((m) => setFoot(ctx.esc(m), true)))(e.message);
        return null;
      }
    }
    function patchLocal(key, patch) {
      lastEvents = lastEvents.map((e) => (e._cthKey === key ? { ...e, ...patch } : e));
      paint();
    }
    function moveEvent(ev, first, last) {
      if (cthDayDiff(first, last) < 0) return;
      const patch = cthPatchForSpan(ev, first, last);
      patchLocal(ev._cthKey, patch);
      withGCal(async (GCal) => {
        await GCal.patchEvent(ev._cthCal || "primary", ev.id, patch);
      }, async (m) => { toast("Could not move: " + m); await load(); });
    }
    function renameEvent(ev, summary) {
      patchLocal(ev._cthKey, { summary });
      withGCal(async (GCal) => {
        await GCal.patchEvent(ev._cthCal || "primary", ev.id, { summary });
      }, async (m) => { toast("Could not rename: " + m); await load(); });
    }
    function toggleDone(ev) {
      const next = cthIsDone(ev) ? "0" : "1";
      const patch = { extendedProperties: { shared: { ...cthShared(ev), cthulhuDone: next } } };
      patchLocal(ev._cthKey, patch);
      withGCal(async (GCal) => {
        await GCal.patchEvent(ev._cthCal || "primary", ev.id,
          { extendedProperties: { shared: { cthulhuDone: next } } });
      }, async (m) => { toast("Could not update: " + m); await load(); });
    }
    function removeEvent(ev) {
      lastEvents = lastEvents.filter((e) => e._cthKey !== ev._cthKey);
      paint();
      withGCal(async (GCal) => {
        await GCal.deleteEvent(ev._cthCal || "primary", ev.id);
      }, async (m) => { toast("Could not delete: " + m); await load(); });
    }

    /* --- data ---------------------------------------------------------------- */
    let loading = false;
    async function load(manual) {
      if (disposed || loading) return;
      loading = true;
      try {
        let GCal;
        try {
          GCal = await CTH_GCAL_READY;
        } catch (e) {
          if (!disposed) setFoot("Calendar auth module failed to load: " + ctx.esc(e.message), true);
          return;
        }
        if (disposed) return;
        const auth = await GCal.getAuth();
        if (disposed) return;
        if (!auth.clientId) {
          connected = false;
          setFoot("Open <b>⚙</b> to add your Google OAuth client ID and connect.");
          return;
        }
        if (!(await GCal.isConnected())) {
          connected = false;
          if (!disposed) setFoot("Open <b>⚙</b> and choose <b>Connect</b> to link Google Calendar.");
          return;
        }
        connected = true;
        if (manual) setFoot("Refreshing…");
        // Attribution and the calendar list are niceties; events are the
        // point. Neither failing may empty the board.
        if (!myEmail) {
          try { myEmail = await GCal.getMyEmail(); }
          catch (e) { console.warn("[Cthulhu:calendar] no attribution:", e.message); }
        }
        if (!calendars) {
          try { calendars = await cthListCalendars(GCal); }
          catch (e) { console.warn("[Cthulhu:calendar] no calendar list:", e.message); }
        }
        if (disposed) return;
        const { start, endExcl } = visibleRange();
        const keys = Object.keys(roles);
        const problems = [];
        const perCal = await Promise.all(keys.map(async (key) => {
          try {
            const items = await GCal.listEvents(key, start, endExcl);
            for (const ev of items) { ev._cthCal = key; ev._cthKey = key + "|" + ev.id; }
            return items;
          } catch (e) {
            problems.push({ key, msg: e.message });
            return [];
          }
        }));
        if (disposed) return;
        // Every calendar failed: that is the auth problem it used to be.
        if (problems.length && problems.length === keys.length) {
          setFoot(ctx.esc(problems[0].msg) + " — open <b>⚙</b> to reconnect.", true);
          return;
        }
        lastEvents = perCal.flat();
        setFoot(problems.length
          ? problems.map((p) => "Could not read <b>" + ctx.esc(calName(p.key)) + "</b>: " + ctx.esc(p.msg)).join("<br>")
          : "", !!problems.length);
        paint();
      } finally {
        loading = false;
      }
    }

    // Test seam: tools/home-widgets-test.py injects events here and drives the
    // board with real pointer input, since there is no Google account in CI.
    root._cthCalDebug = {
      inject(events, opts) {
        if (opts && opts.calendars) {
          calendars = opts.calendars;
        }
        if (opts && opts.connected !== undefined) connected = !!opts.connected;
        lastEvents = events.map((ev) => {
          const cal = ev._cthCal || "primary";
          return { ...ev, _cthCal: cal, _cthKey: cal + "|" + ev.id };
        });
        paint();
      },
      events() { return lastEvents; },
      roles() { return { ...roles }; },
      openEditor,
    };

    paint(); // the grid never waits for Google
    load();
    // Clamped: the whole point is catching phone edits, and an interval longer
    // than ~15 min stops feeling live.
    const mins = Math.min(15, Math.max(5, Number(ctx.config.pollMinutes) || 5));
    const iv = setInterval(() => load(), mins * 60 * 1000);
    ctx.onCleanup(() => clearInterval(iv));
  },

  configUI(panel, ctx) {
    const status = document.createElement("div");
    status.className = "cw-cal-foot";
    status.textContent = "Checking…";
    panel.appendChild(status);

    /* WHY THIS IS A SEPARATE ELEMENT: the reason a connect failed used to be
     * written into `status`, and then the finally-block's paintStatus() wrote
     * "Status: not connected" straight over it a moment later. The failure was
     * therefore invisible -- the sign-in tab said authorisation was received,
     * the panel said not connected, and nothing ever said why. paintStatus()
     * never touches this line, so the reason survives. */
    const errLine = document.createElement("div");
    errLine.className = "cw-cal-foot err";
    errLine.style.userSelect = "text";
    panel.appendChild(errLine);
    const showErr = (msg) => {
      errLine.textContent = msg ? "Could not connect: " + msg : "";
      if (msg) console.error("[Cthulhu:calendar] connect failed:", msg);
    };

    const help = document.createElement("div");
    help.className = "cw-cal-foot";
    help.innerHTML =
      "Needs an OAuth client from your own Google Cloud project " +
      "(<b>Desktop app</b>), with the <b>Google Calendar API</b> enabled. " +
      "See this widget's README for the full walkthrough.";
    panel.appendChild(help);

    const idRow = document.createElement("label");
    idRow.textContent = "Client ID";
    const idInput = document.createElement("input");
    idInput.type = "text";
    idInput.placeholder = "xxxxx.apps.googleusercontent.com";
    idRow.appendChild(idInput);
    panel.appendChild(idRow);

    const secRow = document.createElement("label");
    secRow.textContent = "Client secret";
    const secInput = document.createElement("input");
    secInput.type = "password";
    secInput.placeholder = "from the same Desktop app client";
    secRow.appendChild(secInput);
    panel.appendChild(secRow);

    /* Nothing here is a native <select>: on this page a select's menu is a
     * chrome-level popup whose choice never comes back as a change event, so
     * picking anything silently did nothing. ctx.ui.selectRow builds the same
     * control out of buttons. */
    const save = (patch) => ctx.saveConfig({ ...ctx.config, ...patch }, { refresh: true });

    // ---- calendars, each with a role ----
    const calField = ctx.ui.field("Calendars");
    const calList = document.createElement("div");
    calField.appendChild(calList);
    const calNote = document.createElement("div");
    calNote.className = "cw-ui-note";
    calNote.textContent =
      "Everything not Off shows on one board. For the other person's calendars to appear here, " +
      "they share them with your Google account (Google Calendar → the calendar's Settings → " +
      "Share with specific people); tag those Theirs. A calendar you both write to is Shared: " +
      "each item is credited to whoever created it.";
    calField.appendChild(calNote);
    panel.appendChild(calField);

    const createRow = ctx.ui.selectRow("New items go to", [{ value: "primary", label: "Primary" }],
      ctx.config.createIn || "primary", (v) => save({ createIn: v }), { stack: true });
    panel.appendChild(createRow);

    // The roles map as stored: EVERY listed calendar gets an entry (Off
    // included), so "all Off" is an explicit choice and does not fall back to
    // the legacy single-calendar migration.
    let known = []; // [{key, name, canWrite}]
    const rolesNow = () => {
      const cfg = ctx.config.calendars;
      if (cfg && typeof cfg === "object" && Object.keys(cfg).length) return { ...cfg };
      return { ...cthCalendarRoles(ctx.config) };
    };
    function paintCalendars() {
      calList.textContent = "";
      const roles = rolesNow();
      const rows = known.length ? known : Object.keys(roles).map((k) => ({ key: k, name: k === "primary" ? "Primary" : k, canWrite: true }));
      for (const c of rows) {
        const row = document.createElement("div");
        row.className = "cw-cal-calrow";
        row.dataset.cal = c.key;
        const nm = document.createElement("div");
        nm.className = "cw-cal-calname";
        nm.textContent = c.name;
        nm.title = c.name;
        if (!c.canWrite) {
          const ro = document.createElement("small");
          ro.textContent = " — read only";
          nm.appendChild(ro);
        }
        row.appendChild(nm);
        const group = document.createElement("div");
        group.className = "cw-ui-choice cw-cal-roles";
        const cur = roles[c.key] || "off";
        for (const r of CTH_ROLES) {
          const b = document.createElement("button");
          b.type = "button";
          b.className = "cw-ui-choice-btn" + (r.id === cur ? " on" : "");
          b.dataset.value = r.id;
          b.textContent = r.label;
          b.title = r.title;
          b.addEventListener("click", (e) => {
            e.stopPropagation();
            const next = rolesNow();
            // Make sure every known calendar has an explicit entry (see above).
            for (const k of known) if (!(k.key in next)) next[k.key] = "off";
            next[c.key] = r.id;
            const patch = { calendars: next };
            // The default target must stay a writable, switched-on calendar.
            const on = Object.keys(next).filter((k) => next[k] !== "off");
            const writableOn = on.filter((k) => { const kc = known.find((x) => x.key === k); return !kc || kc.canWrite; });
            const cur2 = ctx.config.createIn || "primary";
            if (!writableOn.includes(cur2)) patch.createIn = writableOn[0] || cur2;
            save(patch);
            paintCalendars();
            paintCreate();
          });
          group.appendChild(b);
        }
        row.appendChild(group);
        calList.appendChild(row);
      }
    }
    function paintCreate() {
      const roles = rolesNow();
      const on = Object.keys(roles).filter((k) => roles[k] !== "off");
      const opts = on
        .filter((k) => { const kc = known.find((x) => x.key === k); return !kc || kc.canWrite; })
        .map((k) => { const kc = known.find((x) => x.key === k); return { value: k, label: kc ? kc.name : (k === "primary" ? "Primary" : k) }; });
      const cur = ctx.config.createIn || "primary";
      if (!opts.length) opts.push({ value: cur, label: "(no writable calendar is on)" });
      createRow.setOptions(opts, cur);
    }
    paintCalendars();
    paintCreate();

    const modeRow = ctx.ui.selectRow(
      "Show",
      [{ value: "both", label: "Both" }, { value: "me", label: "Mine" }, { value: "them", label: "Theirs" }],
      ctx.config.mode || "both",
      (v) => save({ mode: v })
    );
    panel.appendChild(modeRow);

    const labelRow = document.createElement("label");
    labelRow.textContent = "Their label";
    const labelInput = document.createElement("input");
    labelInput.type = "text";
    labelInput.placeholder = "Theirs";
    labelInput.value = ctx.config.theirLabel || "";
    labelRow.appendChild(labelInput);
    panel.appendChild(labelRow);

    const pollRow = ctx.ui.selectRow(
      "Refresh, min",
      [5, 10, 15].map((v) => ({ value: v, label: String(v), title: "Every " + v + " minutes" })),
      ctx.config.pollMinutes || 5,
      (v) => save({ pollMinutes: parseInt(v, 10) })
    );
    panel.appendChild(pollRow);

    const doneRow = document.createElement("label");
    const doneBox = document.createElement("input");
    doneBox.type = "checkbox";
    doneBox.checked = !!ctx.config.showCompleted;
    doneRow.appendChild(doneBox);
    doneRow.appendChild(document.createTextNode(" Show completed items"));
    panel.appendChild(doneRow);

    labelInput.addEventListener("change", () => save({ theirLabel: labelInput.value.trim() || "Theirs" }));
    doneBox.addEventListener("change", () => save({ showCompleted: doneBox.checked }));

    const actions = document.createElement("div");
    actions.style.cssText = "display:flex; gap:8px; flex-wrap:wrap;";
    const saveBtn = document.createElement("button");
    saveBtn.type = "button"; saveBtn.className = "cw-cfg-save"; saveBtn.textContent = "Save client";
    const connectBtn = document.createElement("button");
    connectBtn.type = "button"; connectBtn.className = "cw-cfg-save"; connectBtn.textContent = "Connect";
    actions.appendChild(saveBtn); actions.appendChild(connectBtn);
    panel.appendChild(actions);

    (async () => {
      let GCal;
      try {
        GCal = await CTH_GCAL_READY;
      } catch (e) {
        status.textContent = "Auth module failed to load: " + e.message;
        return;
      }
      const auth = await GCal.getAuth();
      idInput.value = auth.clientId || "";
      secInput.value = auth.clientSecret || "";

      async function paintStatus() {
        const connected = await GCal.isConnected();
        status.innerHTML = connected ? "Status: <b>connected</b>" : "Status: <b>not connected</b>";
        connectBtn.textContent = connected ? "Disconnect" : "Connect";
        if (!connected) return;
        try {
          const cals = await cthListCalendars(GCal, true);
          known = cals.map((c) => ({ key: cthCalKey(c), name: c.summary + (c.primary ? " (primary)" : ""), canWrite: !!c.canWrite }));
          // Keep a configured calendar visible even if the account no longer
          // lists it, so it can't silently look like something else is chosen.
          for (const k of Object.keys(rolesNow())) {
            if (!known.some((c) => c.key === k)) known.push({ key: k, name: k + " (not in your list any more)", canWrite: true });
          }
          paintCalendars();
          paintCreate();
        } catch (e) {
          status.innerHTML = "Status: <b>connected</b>, but listing calendars failed: " + ctx.esc(e.message);
        }
      }
      await paintStatus();

      saveBtn.addEventListener("click", async () => {
        saveBtn.disabled = true;
        saveBtn.textContent = "Saved";
        await GCal.setClient(idInput.value.trim(), secInput.value.trim());
        setTimeout(() => { saveBtn.disabled = false; saveBtn.textContent = "Save client"; }, 1200);
        await paintStatus();
        ctx.refresh();
      });

      connectBtn.addEventListener("click", async () => {
        if (await GCal.isConnected()) {
          await GCal.disconnect();
          showErr("");
          await paintStatus();
          ctx.refresh();
          return;
        }
        await GCal.setClient(idInput.value.trim(), secInput.value.trim());
        connectBtn.disabled = true;
        connectBtn.textContent = "Waiting for Google…";
        status.innerHTML = "A Google sign-in tab has opened. Approve access there.";
        showErr("");
        try {
          await GCal.connect();
          ctx.refresh();
        } catch (e) {
          showErr(e.message);
        } finally {
          connectBtn.disabled = false;
          await paintStatus();  // safe now: it does not own the error line
        }
      });
    })();
  },
});

/** Build the Calendar API event body for a new item. `endDate` (inclusive,
 *  YYYY-MM-DD) makes a multi-day item. Exposed at module scope so it can be
 *  unit-checked without a live account. */
function cthBuildEventBody(o) {
  const body = {
    summary: o.summary,
    extendedProperties: { shared: { cthulhuKind: o.kind, cthulhuDone: "0" } },
  };
  if (o.notes) body.description = o.notes;
  const [y, m, d] = o.date.split("-").map(Number);
  const lastIncl = o.endDate && cthDayDiff(o.date, o.endDate) > 0 ? o.endDate : o.date;
  if (o.allDay) {
    // all-day `end.date` is EXCLUSIVE, so a single-day item ends the next day.
    body.start = { date: o.date };
    body.end = { date: cthAddDays(lastIncl, 1) };
  } else {
    const [hh, mm] = (o.time || "09:00").split(":").map(Number);
    const start = new Date(y, m - 1, d, hh, mm);
    // A timed item across several days keeps its start time each day only in
    // Google's head as "one long event": the end is the last day at start +
    // duration, which is what a multi-day timed event is.
    const [ly, lm, ld] = lastIncl.split("-").map(Number);
    const end = new Date(ly, lm - 1, ld, hh, mm + (o.durationMin || 60));
    // Wall-clock strings + an explicit zone: sending a UTC "Z" time here would
    // shift the item for anyone not on UTC.
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    body.start = { dateTime: cthLocalIso(start), timeZone: tz };
    body.end = { dateTime: cthLocalIso(end), timeZone: tz };
  }
  return body;
}
