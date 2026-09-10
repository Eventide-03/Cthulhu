# Calendar widget

A Notion-style **month board** on top of Google Calendar — several calendars
at once. The whole month is a 7-column grid; every item is a box on its day,
and an item that runs over several days is one bar across them.

- **+ on a day** — hover a day, press its **+**. The **item editor** opens,
  Notion-style: name (focused — type and press **Enter**), **which calendar
  it goes in**, its kind (Task / Deadline / Event / Project — a pill, Google
  has no notion of it), start and end date (◀ ▶ step a day), all-day or a
  time and duration, and notes. **Esc** cancels.
- **Drag a box** to another day to move it. A timed item keeps its time of day,
  so *Tuesday 9 am* dragged to Thursday is *Thursday 9 am*.
- **Drag a box's left or right edge** to change when it starts or ends — that
  is how a one-day item becomes a three-day bar, or back again.
- **Click a box's name** to rename it in place.
- **Hover a box** for **✓** (mark done — non-destructive, the box dims and
  strikes through), **✎** (open it in the editor — change anything, including
  which calendar it lives in) and **×** (delete — **one click**; it goes to
  the calendar's trash on Google's side, where it can be restored for 30 days).
- **Mine / Theirs / Both** — click the chip in the header to cycle, or set it
  in ⚙. Which side an item is on comes from its calendar's role (below); in
  *Both*, the other person's boxes have a dashed border. With more than one
  calendar on the board each box also names its calendar.
- **‹ Today ›** — move between months. **⟳** refreshes immediately rather than
  waiting for the poll.
- **Polls every 5–15 minutes** (⚙), so an edit made on your phone lands here on
  its own.

Boxes from a **read-only** calendar (one shared with you as "see all event
details", or a school system's feed) are on the board but cannot be dragged,
renamed or deleted, and the editor never offers them as a destination.

## Several calendars, each with a role

⚙ lists every calendar your Google account can see, each with a role:

| role | shows | side |
| --- | --- | --- |
| **Off** | no | — |
| **Mine** | yes | mine, whoever created the item |
| **Theirs** | yes | theirs — the other person's calendar, shared with you |
| **Shared** | yes | by creator — a calendar you *both* write to |

Everything that is not Off loads onto the one board, so a read-only school
calendar and a personal one sit together while **New items go to** (also in ⚙)
names the writable calendar new ones are created in. The editor lets you pick
a different writable one per item.

**For the other person's calendars to appear in your list, they share them
with your Google account**: Google Calendar → the calendar's *Settings and
sharing* → *Share with specific people or groups* → your address, with "See
all event details" (read) or "Make changes to events" (write). Once accepted,
their calendars are in your ⚙ list; tag them **Theirs**. There is no other way
for one Google account to read another's calendar, so this widget does not
pretend otherwise — the second account is never signed in here.

Every edit goes straight to Google (as a partial update, so nothing else on the
event is touched). The board updates optimistically first and reloads if Google
says no, with the reason in a toast.

The grid is drawn locally from the system clock, so it renders before you
connect anything — you just won't have any boxes on it, and **+** will ask you
to connect first.

## Why you supply your own Google client

Cthulhu ships no Google credentials. An OAuth client can't be embedded in an
open-source browser: the "secret" would be public in the repo, and every
install would share one project's quota and consent screen. So you create a
client inside your own Google Cloud project and it stays yours — the token
never leaves your machine.

(For "Desktop app" clients Google itself states the secret *"isn't treated as a
secret"*, since an installed app can't keep one. What actually protects the
exchange is **PKCE**, which this widget uses.)

## 1. Share calendars (in Google Calendar, not Cloud Console)

This part is easy to miss — it isn't a Cloud Console step. Two shapes work,
and they mix:

**A calendar you both write to** (role *Shared*):

1. [Google Calendar](https://calendar.google.com) → **Other calendars → + →
   Create new calendar**. Name it, hit **Create**.
2. Open that calendar's **Settings → Share with specific people or groups →
   Add people**.
3. Add the other person's Google address, and set permission to
   **"Make changes to events"** — anything lower and their create/complete/
   delete buttons will fail.
4. They accept the invite from their email. It now appears in both accounts.

**Each other's own calendars** (role *Theirs* on the receiving side): each of
you shares your personal / school calendars with the other's address the same
way, with "See all event details" (they can look) or "Make changes to events"
(they can add to it). A calendar someone else feeds you (a school's, say) can
only be re-shared if its owner allowed that; if the option is greyed out, that
calendar stays on the machine that subscribes to it.

## 2. Google Cloud setup

1. **console.cloud.google.com** → create or pick a project.
2. **APIs & Services → Library** → enable the **Google Calendar API**.
3. **APIs & Services → Google Auth Platform** (the old "OAuth consent screen";
   Google reorganised it into Branding / Audience / Clients / Data Access).
4. **Branding** — app name, user support email, developer contact email.
5. **Audience → External.** On a personal Gmail this is the only option
   (Internal requires a Workspace org).
6. **Data Access → Add scopes.** Add **both**:
   ```
   https://www.googleapis.com/auth/calendar.events
   https://www.googleapis.com/auth/calendar.calendarlist.readonly
   ```
   These genuinely don't overlap — per Google's API reference, `events.insert`
   does *not* accept a calendarlist scope, and `calendarList.list` does *not*
   accept `calendar.events`. With only the first, the ⚙ calendar list comes
   up empty; with only the second, every create/move/complete/delete fails. Two
   narrow scopes rather than the blanket `calendar` scope keeps this to
   "read my calendar list, read/write events" and nothing more.
7. **Clients → Create client → Desktop app.** Copy the **client ID** and
   **client secret**.
8. **Audience → Publish app** (Testing → In Production). Google expires refresh
   tokens after **7 days** while an app sits in *Testing*, so skipping this
   means re-authorising every week. The 100-user cap for unverified apps is
   irrelevant at two people.

## 3. Connect (each person, on their own machine)

Both of you use the **same client ID and secret** — it's one project — but each
signs in with their **own Google account**, which is what makes Mine/Theirs
attribution work.

1. Add the Calendar widget → **⚙** → paste client ID + secret → **Save client**.
2. **Connect**. A Google tab opens.
3. `calendar.events` is a sensitive scope, so an unverified app shows
   *"Google hasn't verified this app"* → **Advanced → Go to (your app)**. This
   is expected, not a failure.
4. Back in ⚙, give each calendar in the **Calendars** list its role (the list
   only fills in once you are connected — before that it just shows *Primary*)
   and pick where **New items go to**.
5. Optionally set **Their label** to the other person's name, so the mode chip
   reads e.g. "Sam" instead of "Theirs".

## How things are stored

**Kind** (task/deadline/event/project) and **done state** live in the event's
`extendedProperties.shared`, not in the title — so ticking something off
doesn't mangle the text the other person sees in their own Google Calendar, and
both of you see the same state (`shared` rather than `private`, which is
per-copy). Items created outside the widget simply show no kind badge and start
as not-done.

**Credentials** (client id/secret, refresh token, and your own address for
attribution) go in a **private IndexedDB store** (DB `cthulhu-gcal`),
deliberately *not* in the widget's config object — widget config is serialized
into the saved layout and broadcast to other tabs, so credentials there would
ride along into any layout export. Only display preferences (the calendar
roles, the default calendar for new items, mode, label, poll interval) live in
the widget config. A layout saved before roles existed is migrated: its single
`calendarId` becomes *Mine* if it was the primary calendar, else *Shared*.

**Event identity.** The same invite can appear in two calendars with the same
event id, so every loaded event is keyed by calendar + id, and every edit goes
to the calendar the box came from.

**Disconnect** (in ⚙) drops the tokens but keeps the client ID/secret, so
reconnecting doesn't mean typing them again.

## If Connect doesn't stick

The sign-in tab saying *"Authorisation received"* only means Google redirected
back with a code. The code still has to be exchanged for tokens, and that
exchange can fail — in which case ⚙ keeps saying **not connected**.

The reason is printed under the status line. The common ones:

| What it says | What to change |
| --- | --- |
| `redirect_uri_mismatch` | Your OAuth client is a **Web application**. It has to be a **Desktop app** — that is the only type Google lets use `127.0.0.1` on an arbitrary port. Make a Desktop app client and use its id and secret. |
| `invalid_client` / `unauthorized_client` | The id and secret aren't from the same Desktop app client, or a stray space crept in. |
| `invalid_grant` on a later refresh | The project is still on the **Testing** audience, where refresh tokens expire after 7 days. Publish it under Audience. |
| `invalid_scope` | Add **both** scopes under Data Access. |
| `access_denied` | The Google screen was declined. On the unverified-app warning, choose **Advanced → Go to (your app)**. |

> That reason used to be invisible: it was written into the status line, and
> then the status was repainted as "not connected" a moment later, wiping it.
> The sign-in tab claimed success, the panel claimed failure, and nothing said
> why. It now has its own line that the repaint never touches.

## Nothing in ⚙ or the editor is a native dropdown or date picker

The calendar roles, Show, Refresh and the editor's calendar / kind / duration
choosers are groups of buttons, and the editor's dates are typed
(`YYYY-MM-DD`, with ◀ ▶ to step a day). On `about:cthulhu` a `<select>`'s menu
— and a `<input type=date>`'s picker — is a chrome-level popup the page only
reaches through an actor pair, and the choice never comes back as a `change`
event, so picking anything silently did nothing. Setting `.value` from script
worked, which is why it went unnoticed for a while. See `cthUi.selectRow` in
`newtab/widgets.js`.

## How the sign-in actually completes

Google redirects to `http://127.0.0.1:<port>/` — the standard loopback flow for
installed apps. The widget opens a short-lived listener on an OS-assigned port,
reads the `?code=` off the request, answers with a small confirmation page, and
closes the socket immediately (also on a 5-minute timeout if you never finish).

This is possible because `about:cthulhu` runs with the system principal in the
parent process (see `AboutCthulhu.sys.mjs`), which gives the page both
`nsIServerSocket` and cross-origin `fetch`.

## Known limits

- **A *Shared* calendar's sides need separate Google accounts.** There the
  side is the event's creator; if you both signed in as the same account,
  everything reads as "mine". (*Mine* and *Theirs* calendars do not depend on
  this.)
- **Deleting is one click and Google-side.** The item goes to that calendar's
  trash in Google Calendar, where it can be restored for 30 days; the widget
  does not ask first.
- **Recurring events** are expanded into individual instances
  (`singleEvents: true`). Completing one instance marks that instance only —
  which is usually what you want for a recurring chore, but it does mean the
  done flag doesn't carry to the series.

## Files

```
calendar.js   widget: the month board over several calendars (the item
              editor / drag to move / drag an edge to resize / rename /
              complete / delete), roles + mode filter, config UI
gcal.js       OAuth (PKCE + loopback redirect), token refresh, Calendar API
              (list, insert, patch, move, delete)
```

`gcal.js` is loaded by `calendar.js` itself — the widget loader only
auto-loads `widgets/<id>/<id>.js`.
