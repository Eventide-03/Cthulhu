# Calendar widget

Built around a Google Calendar **shared between two people**. Shows what's on
today, lets either person quick-create and tick things off, and filters by who
created what.

- **Mine / Theirs / Both** — click the mode chip in the header to cycle, or set
  it in ⚙. Attribution comes from the event's creator.
- **+** — quick-create a Task / Deadline / Event / Project with a date,
  optional time + duration, and notes.
- **✓ / ×** on each row — mark done (non-destructive) or delete (needs a second
  click to confirm).
- **⟳** — refresh immediately, rather than waiting for the poll.
- **Polls every 5–15 minutes** (⚙), so an edit made on your phone lands here on
  its own.
- **Hover the widget** for the whole month, with a dot on every day that has
  something on it — the dots follow the same Mine/Theirs/Both filter.

The month grid is drawn locally from the system clock, so it still works before
you connect anything — you just won't get event dots.

## Why you supply your own Google client

Cthulhu ships no Google credentials. An OAuth client can't be embedded in an
open-source browser: the "secret" would be public in the repo, and every
install would share one project's quota and consent screen. So you create a
client inside your own Google Cloud project and it stays yours — the token
never leaves your machine.

(For "Desktop app" clients Google itself states the secret *"isn't treated as a
secret"*, since an installed app can't keep one. What actually protects the
exchange is **PKCE**, which this widget uses.)

## 1. Make the shared calendar (in Google Calendar, not Cloud Console)

This part is easy to miss — it isn't a Cloud Console step.

1. [Google Calendar](https://calendar.google.com) → **Other calendars → + →
   Create new calendar**. Name it, hit **Create**.
2. Open that calendar's **Settings → Share with specific people or groups →
   Add people**.
3. Add the other person's Google address, and set permission to
   **"Make changes to events"** — anything lower and their create/complete/
   delete buttons will fail.
4. They accept the invite from their email. It now appears in both accounts.

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
   accept `calendar.events`. With only the first, the ⚙ calendar dropdown comes
   up empty; with only the second, every create/complete/delete fails. Two
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
4. Back in ⚙, pick the shared calendar from the **Calendar** dropdown.
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
ride along into any layout export. Only display preferences (calendar id, mode,
label, poll interval) live in the widget config.

**Disconnect** (in ⚙) drops the tokens but keeps the client ID/secret, so
reconnecting doesn't mean typing them again.

## How the sign-in actually completes

Google redirects to `http://127.0.0.1:<port>/` — the standard loopback flow for
installed apps. The widget opens a short-lived listener on an OS-assigned port,
reads the `?code=` off the request, answers with a small confirmation page, and
closes the socket immediately (also on a 5-minute timeout if you never finish).

This is possible because `about:cthulhu` runs with the system principal in the
parent process (see `AboutCthulhu.sys.mjs`), which gives the page both
`nsIServerSocket` and cross-origin `fetch`.

## Known limits

- **Attribution needs separate Google accounts.** Mine/Theirs is the event
  creator; if you both signed in as the same account, everything reads as
  "mine".
- **Deleting is Google-side and permanent** (it goes to the calendar's trash,
  same as deleting in Google Calendar). Hence the two-click confirm.
- **Recurring events** are expanded into individual instances
  (`singleEvents: true`). Completing one instance marks that instance only —
  which is usually what you want for a recurring chore, but it does mean the
  done flag doesn't carry to the series.

## Files

```
calendar.js   widget: today's list, create/complete/delete, mode filter,
              hover month grid, config UI
gcal.js       OAuth (PKCE + loopback redirect), token refresh, Calendar API
```

`gcal.js` is loaded by `calendar.js` itself — the widget loader only
auto-loads `widgets/<id>/<id>.js`.
