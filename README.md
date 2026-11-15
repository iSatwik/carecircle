# CareCircle 💙 — Elder-centred Medication & Care Management

> **PromptWars × Catalyst – Challenge: Elderly Care & Medication Management Platform**

CareCircle is a shared, secure care space where an **elderly person, their caretakers and their family** manage medicines, doctor appointments and daily routines together — while the **elder stays in charge of their own healthcare decisions**.

**Live demo:** https://carecircle-nvnr.onrender.com

---

## 🎯 Chosen vertical

**Elderly Care & Medication Management Platform.** The persona is an elder (65+) who manages daily medicines, together with the caretakers and family members who support them.

## 🧠 Approach and logic

- **Elder at the centre:** every decision path checks the user's role. Medicine changes by family or caretakers become requests that only the elder can approve, and only the elder can change settings or remove people.
- **Context-aware reminders:** for each scheduled dose, the reminder engine compares the current time in the elder's timezone with the dose time and whether it was logged. It then picks one action: a heads-up 15 minutes before; a nudge to the elder and caretaker 30 minutes after; or, after 90 minutes, marking the dose missed and alerting the family. Every email has a fixed key, so it is sent only once.
- **Health signals:** daily check-ins compare blood pressure and sugar against conservative thresholds. Readings are shared with the family only when they are worrying or the elder says they feel unwell.
- **Assistive AI:** Gemini explains medicines and writes a weekly family note in the user's language. If Gemini is unavailable, the app falls back to safe built-in text.

## 📝 Assumptions

- Each care circle belongs to one elder. Members join with a circle code and passcode shared in person or by phone.
- Medicine times are entered in the elder's local timezone (default Asia/Kolkata).
- A dose not logged within 30 minutes is "not taken yet", and after 90 minutes it is "missed". Doses scheduled before a medicine was added are never counted as missed.
- Health alert thresholds (BP ≥ 180/110 or < 90 systolic; sugar < 70 or > 300 mg/dL) only decide when to notify the family. They are not a diagnosis.
- AI output is general information, not medical advice, and is always labelled that way.
- Without email or AI keys, the app still works fully: emails appear in the in-app outbox and AI uses fallback text. On the free host, data is kept in memory and resets on restart; Firestore is used on Google Cloud.

## ✨ How it answers the problem statement

| Requirement | How CareCircle does it |
|---|---|
| Shared ecosystem for elder, caretakers & family | One **Care Circle** per elder. Members join with a **circle code + passcode** and a role (`elder`, `caretaker`, `family`). |
| Secure, passcode-based access | Passcodes hashed with **scrypt** + per-circle salt, constant-time comparison, rate-limited join, short-lived signed sessions scoped to one circle. |
| View / add / edit / manage medication schedules | Medicines with dose, instructions, multiple daily times, weekdays, end date and pill stock. |
| Track adherence | One-tap **"I took it" / "Skip"** per dose, 7-day adherence chart, per-medicine adherence, late-dose tracking. |
| Monitor upcoming doctor appointments | Appointment list + "next appointment" card, with **Add to Google Calendar** and **Google Maps directions**. |
| Proactive email reminders | **Upcoming dose** (15 min before), **missed dose** (30 min after), **appointments** (24 h and 2 h before) — plus **escalation** and **refill** alerts. |
| Go beyond a basic reminder app | Escalation ladder, elder approval for changes, Gemini explanations & family summaries, read-aloud, refill prediction, transparent activity log. |
| Elder at the centre of decisions | **"My approval required"** mode: medicine changes by others become *requests* only the elder can approve/reject. Only the elder can change settings, the passcode, or remove members. |

## 🌟 Innovative features

**New:** **English, हिन्दी and తెలుగు** across the whole app; a **natural voice** (Google Cloud Text-to-Speech, Chirp 3 HD) that reads the day aloud and speaks every update; a visual **pill box** with Morning, Afternoon, Evening and Night compartments; an **"I need help" button** that emails the whole circle at once; a **daily check-in** for mood, blood pressure and sugar that alerts family about worrying readings; a **streak counter**; and a **health card** to show a doctor.

1. **Smart escalation ladder** – reminders don't stop at one email:
   `T−15 min` elder gets a heads-up → `T+30 min` elder & caretaker nudged → `T+90 min` dose auto-marked *missed* and family alerted to check in.
2. **Elder consent for changes** – family can *propose*, the elder *decides*. Every change is visible to everyone.
3. **Gemini "Explain simply"** – plain-language explanation of any medicine (what it's for, how to take it, side effects to watch), with a safety disclaimer.
4. **Gemini weekly care summary** – a warm, factual update for busy family members, generated *only* from the circle's own adherence data.
5. **Read my day aloud** – the Web Speech API reads the elder's schedule out loud.
6. **Refill alerts** – stock goes down each time a dose is taken; caretakers are emailed when it runs low.
7. **Transparent activity log** – who did what and when, for trust across the family.
8. **Per-person alert preferences** – each member chooses which emails they receive.
9. **Senior-first UI** – large text, A−/A+ text scaling, high-contrast mode, 48 px+ touch targets.
10. **Pill-box view** – today's doses sit in four coloured compartments, the way elders already organise their tablets. A compartment shows "All done" once its doses are taken.
11. **"I need help" button** – one tap sends an urgent email to everyone in the circle, with the emergency contact included. Accidental double-presses send only one email.
12. **Daily check-in** – mood plus optional BP and sugar readings. Clearly worrying values (for example BP ≥ 180/110 or sugar < 70 mg/dL) email caretakers and family right away.
13. **Streak** – counts consecutive days with every dose taken, to motivate the elder.
14. **Health card** – conditions, allergies, emergency contact, current medicines, 30-day adherence and the latest reading on one screen, ready to copy or print for a doctor.
15. **Three languages** – English, Hindi and Telugu for every screen, message and spoken update. Gemini explains medicines and writes the family note in the chosen language.
16. **Natural voice that follows changes** – "Read my day aloud" always fetches the latest schedule. With *Voice on*, every change (dose taken, check-in saved, medicine added, help sent) is spoken out loud. Speech comes from Google Cloud Text-to-Speech's Chirp 3 HD voices (en-IN, hi-IN, te-IN), with the browser's most natural installed voice as a fallback.

## ☁️ Google services used

| Service | Use |
|---|---|
| **Google Cloud Run** | Hosts the containerised app (scales to zero, HTTPS by default). |
| **Google Cloud Firestore** | Stores circles, members, medicines, dose logs, appointments, activity (`STORE=firestore`). |
| **Google Gemini API** | Medicine explanations and weekly family care summaries. |
| **Google Cloud Text-to-Speech** | Natural Chirp 3 HD voices in English (India), Hindi and Telugu for read-aloud and spoken updates. |
| **Google Cloud Scheduler** | Calls `POST /api/cron/tick` every 5 minutes to run reminders (works with scale-to-zero). |
| **Gmail (SMTP)** | Sends reminder emails through a Google App Password (Brevo's HTTPS API is supported for hosts that block SMTP). |
| **Google Fonts** | Atkinson Hyperlegible and Lexend, chosen for low-vision readability. |
| **Google Calendar** | One-tap "Add to Google Calendar" for every appointment. |
| **Google Maps** | Directions link for the hospital or clinic. |
| **Google Cloud Logging** | Structured JSON logs with `severity`, parsed automatically on Cloud Run. |
| **Google Cloud Build / Artifact Registry** | `gcloud run deploy --source .` builds the image. |

## 🏗️ Architecture

```
Browser (vanilla JS, accessible SPA)
   │  HTTPS + Bearer session token
   ▼
Express API on Cloud Run ──► Firestore (data)
   │        │
   │        ├──► Gemini API (explanations, summaries)
   │        └──► Gmail SMTP (reminder emails, de-duplicated)
   ▲
Cloud Scheduler ── POST /api/cron/tick (X-Cron-Secret) ──► Reminder engine
```

```
src/
  app.js              Express app factory (dependency injection → testable)
  server.js           Entry point, graceful SIGTERM shutdown
  config.js           Validated environment config
  routes.js           HTTP API (all /api/circle/* routes scoped by session)
  middleware.js       zod validation, auth, error handling
  validation.js       Request schemas
  db/                 Store interface: Firestore + in-memory implementations
  services/
    careService.js    Domain logic: circles, meds, approvals, doses, appointments
    reminders.js      Idempotent reminder + escalation engine
    schedule.js       Pure timezone-aware dose scheduling & adherence maths
    email.js          SMTP / outbox with once-only delivery keys
    ai.js             Gemini client with timeout, cache, language choice and safe fallback
    tts.js            Google Cloud Text-to-Speech (Chirp 3 HD) with caching and back-off
    vitals.js         Check-in alert thresholds and streak maths
    auth.js           scrypt passcodes, JWT sessions, constant-time compare
    googleLinks.js    Google Calendar & Maps deep links
public/               index.html, styles.css, app.js, i18n.js (no frameworks)
tests/                47 tests (node:test + supertest)
```

## 🔐 Security

- Passcodes: **scrypt** (N=16384) with a random salt; never returned by the API.
- Sessions: HS256 JWT, 12 h expiry, issuer-checked, **re-validated against the member list** on each request (removed members lose access immediately).
- Strict **tenant isolation**: the circle comes from the token, never from the URL.
- Same error for "unknown circle" and "wrong passcode" (no enumeration).
- **Helmet** security headers with a strict **Content-Security-Policy** (no inline scripts or styles).
- **Rate limiting** on sign-in, AI and general API routes; JSON body limit of 20 kB.
- **zod** validation on every write (unknown fields stripped, lengths bounded).
- Front end renders user data with `textContent` only (XSS-safe); email HTML is escaped.
- Cron endpoint protected by a secret header compared in constant time.
- Gemini key sent in a header (never in URLs); prompts treat user text strictly as data.
- Container runs as a **non-root** user; `npm audit` reports **0 vulnerabilities**.

## ♿ Accessibility

- Typefaces chosen for readability: **Atkinson Hyperlegible** (designed by the Braille Institute for low-vision readers) and **Lexend** (Google Fonts).
- Semantic landmarks, skip link, one `h1` per view, focus moved to the heading on navigation.
- Fully translated into Hindi and Telugu (`lang` attribute updated for screen readers), with Noto Sans Devanagari and Telugu fonts.
- Spoken updates and read-aloud for low-vision users; the voice can be switched off.
- Every input has a `<label>`; grouped controls use `fieldset`/`legend`; invalid fields get `aria-invalid`.
- `aria-live` regions for toasts, dose updates and AI output; `aria-current` on tabs; descriptive `aria-label`s on actions.
- Keyboard-only friendly with a highly visible focus ring; native `<dialog>` for modals.
- Text scaling (A−/A+), high-contrast theme, `prefers-reduced-motion` support, 18 px base text and 48 px+ buttons.
- Status is never shown by colour alone (text badges + borders); read-aloud for low-vision users.

## ⚡ Efficiency

- Deterministic dose IDs → logging is idempotent, with no duplicate writes.
- Reminder emails use once-only keys (`createIfAbsent`) → safe across ticks and instances.
- Parallel data loading (`Promise.all`), gzip compression and static caching.
- Gemini responses cached in memory; requests time out after 15 s with a fallback.
- No front-end framework: about 100 kB of hand-written HTML/CSS/JS (gzip-compressed in transit).

## 🧪 Testing

```bash
npm install
npm test               # 47 tests: unit + API integration + reminder engine
npm run test:coverage  # ~97% line coverage
```

The tests cover passcode hashing, tokens, tenant isolation, the elder-approval flow, role permissions, input validation, dose logging and pill counts, adherence maths, timezone scheduling, the reminder escalation ladder and de-duplication, appointment and refill alerts, the help button, check-in health alerts, streaks, the health card, Gemini integration with a mocked fetch and fallbacks, and email HTML escaping.

## 🚀 Run locally

```bash
npm install
npm start            # http://localhost:8080 (in-memory store, emails go to the in-app outbox)
```

## 🚀 Deploy on Render (free, no billing needed)

[![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy?repo=https://github.com/iSatwik/carecircle)

`render.yaml` builds the Dockerfile and generates the secrets. You only paste three values:

| Variable | Where to get it |
|---|---|
| `GEMINI_API_KEY` | Free key from [Google AI Studio](https://aistudio.google.com/apikey) |
| `BREVO_API_KEY` | Free key from [Brevo](https://app.brevo.com/settings/keys/api). Emails are sent over HTTPS, because free hosts block SMTP ports. |
| `MAIL_FROM` | `CareCircle <your-brevo-login-email>` |

Without a database the free plan uses the in-memory store, so data resets when the service restarts. A GitHub Actions ping keeps the service awake so reminder checks keep running.

## ☁️ Deploy to Google Cloud Run

[![Open in Cloud Shell](https://gstatic.com/cloudssh/images/open-btn.svg)](https://shell.cloud.google.com/cloudshell/editor?cloudshell_git_repo=https://github.com/iSatwik/carecircle&show=terminal)

**Fastest:** open [Google Cloud Shell](https://shell.cloud.google.com), then run:

```bash
git clone https://github.com/iSatwik/carecircle.git && cd carecircle && bash deploy.sh
```

`deploy.sh` enables the APIs, creates Firestore and a restricted Gemini API key, asks for a Gmail App Password, deploys to Cloud Run, sets up Cloud Scheduler and prints the live URL.

**Manual steps** (same result):

Run these commands one at a time in the Cloud Shell terminal (they work in PowerShell and bash). Replace the `<...>` values.

```bash
gcloud auth login
gcloud config set project <YOUR_PROJECT_ID>
gcloud services enable run.googleapis.com cloudbuild.googleapis.com artifactregistry.googleapis.com firestore.googleapis.com cloudscheduler.googleapis.com texttospeech.googleapis.com
gcloud firestore databases create --location=asia-south1

gcloud run deploy carecircle --source . --region asia-south1 --allow-unauthenticated --min-instances 1 --no-cpu-throttling --set-env-vars "STORE=firestore,JWT_SECRET=<long-random-string>,CRON_SECRET=<another-random-string>,GEMINI_API_KEY=<gemini-key>,SMTP_HOST=smtp.gmail.com,SMTP_PORT=465,SMTP_USER=<you@gmail.com>,SMTP_PASS=<16-char-app-password-no-spaces>,MAIL_FROM=CareCircle <you@gmail.com>"
```

Then set the public URL that emails link to:

```bash
gcloud run services update carecircle --region asia-south1 --update-env-vars "PUBLIC_URL=<your-cloud-run-url>"
```

Optional – Cloud Scheduler (needed if you deploy with scale-to-zero instead of `--min-instances 1`):

```bash
gcloud scheduler jobs create http carecircle-tick --location asia-south1 --schedule "*/5 * * * *" --uri "<your-cloud-run-url>/api/cron/tick" --http-method POST --headers "X-Cron-Secret=<same-cron-secret>"
```

**Notes**
- Gmail App Password: Google Account → Security → 2-Step Verification → App passwords.
- Gemini key: https://aistudio.google.com/apikey
- Natural voice: on Cloud Run the app calls Text-to-Speech with its service account automatically (just enable `texttospeech.googleapis.com` as above). If the API is unavailable, the app falls back to the browser's best voice. Set `TTS_ENABLED=false` to turn it off.
- If Firestore returns a permission error, grant the Cloud Run service account the `Cloud Datastore User` role. In an emergency, deploy with `STORE=memory`: the app still works, but data resets when the service restarts.
- Without SMTP settings, reminders are still generated and shown under **Activity → Reminder emails**.

## 📄 License

MIT © 2026 Tadoori Satwik
