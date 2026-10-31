# Healthbook

A health tracker that works the way habit apps should: you define the rules, it keeps score, and nothing punishes you for a bad week.

Healthbook is an Android app that merges two things people normally keep in separate apps — a **habit tracker** you fully control, and a **health log** that charts how you're actually doing over time. It uses an XP-and-levels loop for motivation, drops the guilt mechanics, and adds the thing habit apps never have: real health data, trends, and a doctor-ready monthly summary.

---

## Why it exists

Most habit apps are rigid — a fixed list of "good habits," a streak that shames you when you break it, and a paywall in front of anything useful. Most health apps are the opposite: they record data beautifully and then do nothing with it.

Healthbook tries to fix both ends.

| Problem | How Healthbook handles it |
|---|---|
| Fixed, someone else's habit list | Every daily, habit, to-do, reward and tracker is yours to create, rename, retag and delete |
| Streak anxiety and penalties | You earn XP and levels for what you do; nothing is ever deducted for what you don't |
| Health data that just sits there | Steps, sleep, resting HR, HRV and weight sync in and get charted against your own goals |
| Nothing to show a doctor | A monthly summary PDF is generated from your own numbers — no AI, no guessing |
| Starting from a blank screen | A short sign-up builds a starter plan from your goals and schedule |
| Locked into one person's setup | Your whole plan exports as plain text you can edit, share, or import from someone else |

**It also respects a few boundaries by design:** your data lives on your phone first and works entirely offline; an account is optional; Health Connect access is read-only; and values you type yourself are never overwritten by a sync.

---

## What it does

**Tasks and motivation**
- **Dailies** — things you want to do every day, or only on chosen days, tied to a part of your day (morning / day / evening / any)
- **Habits** — repeatable counters you can log any number of times, positive or negative
- **To-dos** — one-off tasks with optional checklists
- **Rewards** — things you buy with coins you've earned
- **XP, levels and coins** — awarded on completion (daily 5–15, habit 3–8, to-do 8–25, a log 2, a perfect day 20); coins are half your XP, spent on your own rewards. Levels cost progressively more. Nothing is ever taken away.

**Logging and trends**
- Numeric, count and scale trackers (water, steps, mood, stress, weight, sleep — plus anything you add)
- Per-tracker goals with min/max ranges, and plain-language notes when you're under, over or on target
- Charts per tracker with goal bands, plus routine-completion rates over time

**Automation**
- **Auto-tick**: a daily can complete itself from a tracker — `when water >= 8` or `when weight is logged`. Untick it manually and your choice stands for the day.
- **Reminders**: local notifications per task, scheduled two weeks ahead, automatically skipping days you've already finished the task
- **Health Connect sync**: steps, sleep, resting heart rate, HRV and weight pulled from Samsung Health, Fitbit, Garmin, Google Fit, and most rings and watches

**Monthly medical summary**
- Generated on the 1st for the previous month, entirely by fixed rules — **no AI, no inference, no diagnosis**
- Averages, ranges and trends per metric against standard reference thresholds, plus routine adherence
- Exports as a clean PDF you can share with a doctor

**Personalisation**
- Sign-up collects goals, wake/bed times, units and devices, then generates a starter plan
- Rules import/export as readable plain text — your whole setup in a format you can edit in any notes app and hand to a friend
- System / Light / Dark / AMOLED themes, with an adjustable glow on coloured elements

---

## Architecture

Deliberately dependency-light: no bundler, no framework, no build step for the web layer. `www/` is plain HTML/CSS/JS loaded directly by the Capacitor WebView, which keeps the app small, fast to start, and easy to debug on-device.

```
www/                     The entire app UI and logic (no build step)
├── index.html           Shell + 5-tab nav: Today, Log, Trends, Tasks, Me
├── app.js               Core: state, XP, tasks, trackers, charts, rules parser, reminders
├── cloud.js             Supabase auth + sync (merge, tombstones, conflict resolution)
├── health.js            Health Connect read-only sync
├── report.js            Rule-based monthly summary + PDF generation
├── signup.js            Onboarding flow and plan generation
├── config.js            Supabase URL + anon key (see Configuration)
├── app.css              Theme tokens, light/dark/AMOLED, glow
└── vendor/              supabase-js and jsPDF UMD bundles (committed, no CDN at runtime)

android/                 Capacitor Android project (io.healthbook.app, minSdk 26)
supabase/schema.sql      Tables, row-level security policies, account-deletion function
tests/                   Playwright regression suite + Capacitor/Supabase mocks
.github/workflows/       CI: builds and publishes a signed APK to Releases
```

### Stack

| Layer | Technology |
|---|---|
| Runtime | Capacitor 8.5.3 (Android, minSdk 26 / target 36) |
| UI | Plain HTML, CSS and JavaScript — no framework, no bundler |
| Backend | Supabase (Postgres + Auth), `@supabase/supabase-js` 2.x |
| Health data | `@capgo/capacitor-health` 8.x → Health Connect (read-only) |
| Notifications | `@capacitor/local-notifications` 8.3.1 |
| PDF | jsPDF 4.x |
| Also | `@capacitor/filesystem`, `share`, `haptics`, `app` |
| CI | GitHub Actions → signed release APK on Releases |

### How data is stored

State is one JSON object (`S`) held in `localStorage` and mirrored to Supabase when signed in.

- `S.tasks`, `S.trackers`, `S.rewards` — your definitions, each with a stable id
- `S.hist[YYYY-MM-DD]` — one record per day: completions, habit counts, checklist state, logged values, data source, XP ledger, and `_t`, the time that day last changed
- `S.removed` — tombstones, so a deletion on one device isn't resurrected by another

**Sync merge rules:** each day is taken whole from whichever device has the newer `_t`; entities merge by id minus tombstones; purchases union by timestamp. Signing into a different account on the same phone resets local state first, so two people's data can never mix.

---

## Setup

### Requirements

- Node.js 22+
- Java 21 (Temurin)
- Android SDK (API 36) — only needed for local builds; CI handles this for you
- A Supabase project (free tier is fine) — only if you want accounts and sync

### 1. Install

```bash
git clone https://github.com/MadhavMathur148/Healthbook2.git
cd Healthbook2
npm ci
```

### 2. Configure the backend (optional)

Healthbook runs fully offline with no account. To enable sign-up and cross-device sync:

1. Create a project at [supabase.com](https://supabase.com)
2. Open **SQL Editor**, paste the contents of `supabase/schema.sql`, and run it
3. In **Authentication → Providers → Email**, turn **Confirm email** off if you want sign-up to be instant
4. From **Project Settings → API**, copy the **Project URL** and the **anon / publishable** key into `www/config.js`:

```js
window.HB_CONFIG = {
  supabaseUrl:     "https://YOUR-PROJECT.supabase.co",
  supabaseAnonKey: "YOUR-PUBLISHABLE-KEY"
};
```

> The anon key is designed to ship inside client apps — row-level security is what protects each user's rows, and `schema.sql` sets those policies up. **Never put the `service_role` key here**; it bypasses RLS entirely.
>
> Leave both fields empty to build a fully offline, account-free version.

### 3. Run in a browser

```bash
npx serve www        # or: python3 -m http.server -d www 8000
```

Native features (Health Connect, notifications, haptics) are no-ops in a browser; everything else works.

### 4. Build the APK

**Via CI (recommended)** — push to `main` and GitHub Actions builds a signed APK and publishes it to Releases.

**Locally:**

```bash
npx cap sync android
cd android && ./gradlew assembleRelease
# → android/app/build/outputs/apk/release/app-release.apk
```

### 5. Tests

```bash
pip install playwright && playwright install chromium
python3 tests/regression.py tests
```

19 end-to-end checks covering sync merges, account switching, imported-rules sanitisation, reminder scheduling, the rules parser, and auto-tick behaviour.

---

## Security notes

- **The release keystore in this repo is intentionally public and throwaway.** It exists so every CI build installs as an update over the last one instead of forcing a reinstall. Because its password is in `android/app/build.gradle`, anyone can sign an APK that Android accepts as an update to this app — which is fine for a personal sideloaded build, but **you must generate a private keystore and move the credentials into GitHub Secrets before distributing this app to anyone else or publishing to Play.**
- Imported rules files are sanitised before use — ids, titles, colours and reminder values are validated, so a shared plan can't inject markup or script.
- Health Connect access is read-only and limited to steps, sleep, resting heart rate, HRV and weight. All other health permissions are explicitly stripped from the manifest.
- The monthly summary is produced by fixed thresholds in `report.js`. It is a record of your own numbers, not medical advice, and no part of it is generated by a model.

## Privacy

Everything works offline and stays on your phone unless you create an account. With an account, your data syncs to your own Supabase project under row-level security, and account deletion is a single in-app action backed by a `security definer` function. Full policy: `www/privacypolicy.html`.

## Licence

Personal project, no licence granted. Fork it for your own use.
