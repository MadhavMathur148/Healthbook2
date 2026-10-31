# Healthbook

A habit, logging and trends app for Android. Everything is stored on the phone; nothing is sent anywhere.

## Getting the app

Every push to `main` builds a signed APK on GitHub Actions and publishes it to **Releases**.

1. On your phone, open the repo's **Releases** page and download `Healthbook.apk` from the latest release.
2. Open the file. If Android asks, allow your browser or Files app to install unknown apps.
3. New builds install as updates over the old one and keep your data, because every build is signed with the same key.

## What's inside

- **Sign-up**: optional account, then a few quick questions (about you, up to three goals, usual wake and bed times, devices). A plan is built from the answers with fixed rules, and the day is grouped around the user's own times.
- **Accounts and sync**: Supabase email and password login. Each user's data syncs as one row per table, protected by row-level security. Works fully offline without an account.
- **Health Connect**: read-only sync of steps, sleep, resting heart rate, HRV and weight from any app that writes to Health Connect (Samsung Health, Fitbit, Garmin, Google Fit and most rings and watches). Google Fit's own APIs are being shut down, so Health Connect is the supported route on Android. Values typed by hand are never overwritten.
- **Monthly summaries**: on the 1st of each month the app builds last month's summary on the phone using fixed thresholds (no AI): averages, ranges, change from the previous month, observations to discuss with a doctor, highlights and routine stats. Shareable as a PDF with charts.

- **Today**: XP, level and coins, category rings, up next, quick log, dailies by time of day, habits with + / −, to-dos.
- **Log**: mood, stress, sleep, water, steps, resting heart rate, HRV and weight (ring or watch data entered by hand), plus any trackers you add. Go back up to 90 days.
- **Trends**: week / month / 3 months for every tracker, daily completion with a 17-week heatmap, streaks and habit totals, and a shareable summary for doctor visits.
- **Tasks**: edit everything: dailies (days, time of day, reminders, checklists, auto-tick from a tracker), habits (weekly goals, slips), to-dos, rewards and trackers.
- **Me**: level, rewards shop, appearance (System, Light, Dark, AMOLED), reminders, backup export and import.

## Rules files

Anyone can load their own plan from plain text: **Tasks → Import rules** (paste or pick a .txt / .json file), or choose "Import my own rules" during setup. **Share my rules** exports your plan in the same format for friends. The format guide is built into the import screen; a short example:

```
Dailies:
- Drink a glass of water (morning, nourish)
- Stretch 10 minutes — Notes after a long dash (evening, move, medium, mon wed fri, 18:30)
- 8 glasses of water (day, nourish, when water >= 8)
Habits:
- Workout (move, hard, 3 a week)
- Junk food (nourish, slip)
To-dos:
- Book a dental cleaning (care, important)
Rewards:
- Movie night (100)
Trackers:
- Caffeine (counter, target 3, cups, yellow, on today)
```

Missing a daily never costs XP. Slips are tracked but never penalised.

## Setting up accounts (Supabase)

1. Create a free project at supabase.com.
2. In the SQL editor, run `supabase/schema.sql`.
3. In Authentication → Providers → Email, turn off **Confirm email** for instant sign-up (the free email sender is heavily rate-limited), or leave it on and users confirm by email before signing in.
4. Put the Project URL and the anon / publishable key in `www/config.js`. Never use the service_role key in the app.

Leave `www/config.js` empty to ship an offline-only build.

## Backups

Uninstalling deletes the app's data. Use **Me → Export backup** regularly and keep the file somewhere safe.

## Project layout

- `www/`: the app (plain HTML, CSS and JavaScript, no build step)
- `android/`: Capacitor Android project
- `.github/workflows/build.yml`: builds and releases the APK

The signing key in `android/app/healthbook.keystore` is committed so every build can update the last one. If you fork this to publish your own builds, generate your own key (see `keytool -genkeypair`) and keep it out of public repos.

To change the app, edit files in `www/` and push to `main`.
