# Windage

*Read the wind. Adjust your aim.*

A trading journal for ICT and prop-firm futures traders. Log trades or import them from your broker, track your drawdown line, and see which setups, sessions and habits are making or losing you money.

Live: https://yanshi-creator.github.io/ICT-JOURNAL/
Demo with sample trades: https://yanshi-creator.github.io/ICT-JOURNAL/?demo

## What's in it

- **Dashboard**: account ladder (liquidation line, balance, target), key stats, balance chart, P&L calendar with weekly totals, daily guardrail warnings.
- **Trade log**: entry/stop/exit/partials with live R and P&L estimate, setup model, checklist grading, mistake tags, emotions, screenshots.
- **Broker import**: CSV from Tradovate, NinjaTrader, TopstepX, Rithmic and others. Columns are matched automatically, duplicates are skipped.
- **Playbook**: one card per setup model (Silver Bullet, 2022 Model, Unicorn…) with net P&L, win rate, avg R, profit factor, recent results, best session and most common mistake.
- **Coach**: ranks your money leaks, "what if" scenarios, discipline score, week-over-week review, breakdowns by 14 dimensions including setup model.
- **Daily journal**: pre-market plan plus an end-of-day review (1–5 rating, what went well, what to fix), with "does prep pay?" and "discipline vs P&L".
- **Share cards**: a 1080×1350 image of any trade for Instagram, with an option to hide dollar amounts.
- **Six colour themes**: Dusk, Sakura, Lagoon, Lavender, Brass and Daylight, synced to your account.
- **Multiple accounts** with trailing, end-of-day or static drawdown and an optional trailing lock (Apex style).
- **Installable** on phone and desktop, works offline. Excel export, JSON backup and restore.

## One-time Firebase setup

The app uses the existing Firebase project `journal-6f593`.

1. **Firestore rules (required, since other people will sign up).** Firebase console → Firestore Database → Rules. Replace everything with the contents of [`firestore.rules`](firestore.rules) and click **Publish**. This makes sure each trader can only see their own journal.
2. **Sign-in method.** Authentication → Sign-in method → Email/Password should be **Enabled** (it already is if you've been logging in).
3. **Authorized domains.** Authentication → Settings → Authorized domains should include `yanshi-creator.github.io`. Add any custom domain you use later.
4. **Password reset emails** work out of the box. You can edit the email text under Authentication → Templates.

## Upgrading from v1

The first time an existing user signs in, their journal is moved to the new storage layout automatically:

- v1 kept every trade and screenshot in one Firestore document, which has a hard 1 MB limit. Saving silently failed once a journal got big.
- v2 stores each trade, screenshot and prep day as its own document.
- An untouched copy of the old document is kept at `users/{uid}/legacy/v1`.

## Files

```
index.html            app shell
app.css               styles and the six colour themes
app.js                UI and views
stats.js              all the math (R, drawdown, breakdowns)
coach.js              turns the math into coaching
importer.js           broker CSV parsing and column matching
sharecard.js          draws the shareable trade card
store.js              Firebase storage + migration
demo.js               sample data for ?demo
firebase-config.js    Firebase project keys (public by design)
sw.js, manifest.webmanifest, *.png   installable app
firestore.rules       paste into Firebase console
```

No build step. Edit a file, commit, and GitHub Pages serves it.
