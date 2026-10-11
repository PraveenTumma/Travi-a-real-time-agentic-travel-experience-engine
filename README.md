<div align="center">

```
████████╗██████╗  █████╗ ██╗   ██╗██╗██╗
╚══██╔══╝██╔══██╗██╔══██╗██║   ██║██║██║
   ██║   ██████╔╝███████║██║   ██║██║██║
   ██║   ██╔══██╗██╔══██║╚██╗ ██╔╝██║╚═╝
   ██║   ██║  ██║██║  ██║ ╚████╔╝ ██║██╗
   ╚═╝   ╚═╝  ╚═╝╚═╝  ╚═╝  ╚═══╝  ╚═╝╚═╝
```

### ✈️ AI-Powered Travel Planning. Built for Humans.

*Built at **PromptWars: Hyderabad** — Google for Developers × Hack2Skill*

[![Cloud Run](https://img.shields.io/badge/Google_Cloud_Run-4285F4?style=for-the-badge&logo=google-cloud&logoColor=white)](https://cloud.google.com/run)
[![Firebase](https://img.shields.io/badge/Firebase-FFCA28?style=for-the-badge&logo=firebase&logoColor=black)](https://firebase.google.com)
[![Google Maps](https://img.shields.io/badge/Google_Maps-34A853?style=for-the-badge&logo=google-maps&logoColor=white)](https://developers.google.com/maps)
[![React](https://img.shields.io/badge/React_19-61DAFB?style=for-the-badge&logo=react&logoColor=black)](https://react.dev)
[![FastAPI](https://img.shields.io/badge/FastAPI-009688?style=for-the-badge&logo=fastapi&logoColor=white)](https://fastapi.tiangolo.com)

</div>

---

## 🌍 What is Travi!?

**Travi!** is a real-time, AI-powered travel planning web app. Tell it where you're going, for how long, and what you're into — it builds you a complete, weather-aware, day-by-day itinerary in seconds. Every activity is pinned on a live Google Map. Plans gone wrong? Hit re-plan and the AI adapts instantly. Travel with friends? Invite them, share plans, get notified in real-time.

---

## ✨ Features

### 🤖 AI Itinerary Generation
- Generates a complete **day-by-day travel plan** using Groq (Llama 3.3 70B)
- Weather-aware: pulls **real-time forecasts** from Open-Meteo and adjusts activities (indoor on rainy days)
- Respects your **budget level** (budget / moderate / luxury), **traveler type** (solo / couple / family / group), **dietary restrictions**, **accessibility needs**, and **max daily walking distance**
- Returns **location names, street addresses, and GPS coordinates** for every activity and meal

### 🗺️ Live Google Maps
- Every day's activities and meals are **pinned on an interactive Google Map**
- **Blue markers** = activities, **Yellow markers** = meals
- Click any marker to see name, time, cost, and address in an **info window**
- Map **auto-fits bounds** to show all locations for that day
- Map updates live as you navigate between days

### 🃏 Day-by-Day Card Carousel
- Itinerary renders as a **swipeable card** — one day at a time, no endless scroll
- Navigate with **◀ ▶ arrow buttons** or **← → keyboard arrow keys**
- **Dot indicators** for quick-jump to any day
- Smooth **framer-motion slide transitions** between cards

### 🔄 Real-Time Re-Planning
- Hit any disruption scenario (heavy rain, closed venue, flight delay, feeling unwell) and the AI **re-generates the affected plan on the spot**
- Disruption context is woven into the new itinerary's weather notes

### 💾 Save & Revisit Trips
- **Save any generated itinerary** to your personal trip history with one click
- View, reload, or delete saved trips from your dashboard
- All data synced in real-time via **Cloud Firestore**

### 👫 Friend System & Real-Time Notifications
- **Send friend requests** by email to other Travi! users
- **Accept or reject** incoming requests via the live notification bell in the navbar
- Friends list is synced in real-time — no refresh needed
- Shared trip infrastructure is built and ready (`sharedTrips` Firestore collection)

### 👤 User Profiles & Settings
- **Update your display name and profile picture** from the Settings modal
- **Account deletion** with confirmation guard
- Profile auto-created in Firestore on first sign-in

---

## 🏗️ Architecture

```
┌──────────────────────────────────────────────────────────────────┐
│                      Google Cloud Run                            │
│                                                                  │
│   ┌──────────────────────────────────────────────────────────┐   │
│   │                   FastAPI Backend                        │   │
│   │                                                          │   │
│   │   GET  /api/health        POST /api/plan                 │   │
│   │   GET  /api/maps-key      POST /api/replan               │   │
│   │                                                          │   │
│   │              ┌─────────────────────┐                     │   │
│   │              │   TripOrchestrator  │                     │   │
│   │              └────────┬────────────┘                     │   │
│   │                       │ runs concurrently                │   │
│   │          ┌────────────┴──────────────┐                   │   │
│   │          ▼                           ▼                   │   │
│   │   ┌─────────────┐          ┌──────────────────┐          │   │
│   │   │WeatherService│          │   LLM Service    │          │   │
│   │   │ Open-Meteo   │          │  Groq Llama 3.3  │          │   │
│   │   │  (free API)  │          │  70B Versatile   │          │   │
│   │   └──────┬───────┘          └────────┬─────────┘          │   │
│   │          └──────────┬────────────────┘                   │   │
│   │                     ▼                                     │   │
│   │         weather-enriched JSON itinerary                   │   │
│   │         (with lat/lng for every location)                 │   │
│   │                                                          │   │
│   ├──────────────────────────────────────────────────────────┤   │
│   │              React Frontend (Static Build)               │   │
│   │                                                          │   │
│   │  Landing.jsx  →  Dashboard.jsx  →  ItineraryMap.jsx      │   │
│   │  Login.jsx    →  FriendSystem.jsx → Notifications.jsx    │   │
│   │  SettingsModal.jsx  ←→  firestoreService.js              │   │
│   └──────────────────────────────────────────────────────────┘   │
└──────────────────────────────────────────────────────────────────┘
           │                    │                    │
           ▼                    ▼                    ▼
   ┌───────────────┐   ┌────────────────┐   ┌───────────────────┐
   │ Firebase Auth │   │ Cloud Firestore │   │  Google Maps API  │
   │ (Google OAuth)│   │  5 collections │   │  (JS API + Pins)  │
   └───────────────┘   └────────────────┘   └───────────────────┘
```

---

## 🗄️ Firestore Data Model

```
users/
  {uid}/
    displayName, email, photoURL, updatedAt

friendRequests/
  {id}/
    fromUid, fromEmail, fromName, fromPhoto
    toEmail, toUid
    status: "pending" | "accepted" | "rejected"
    createdAt

friends/
  {id}/
    users: [uid1, uid2]
    userEmails: [email1, email2]
    userNames:  [name1, name2]
    userPhotos: [photo1, photo2]
    createdAt

savedTrips/
  {id}/
    uid, userEmail
    destination, startDate, endDate
    budgetLevel, travelerType, preferences
    itinerary: { full AI response JSON }
    createdAt

sharedTrips/
  {id}/
    createdBy, creatorName
    members: [uid1, uid2, ...]
    memberEmails: [...]
    destination, startDate, endDate
    itinerary, status, createdAt
```

---

## 🛠️ Tech Stack

| Layer | Technology | Purpose |
|-------|-----------|---------|
| **Backend** | Python 3.11 + FastAPI | Async REST API |
| **Frontend** | React 19 + Vite | UI framework |
| **AI / LLM** | Groq (Llama 3.3 70B) | Itinerary generation |
| **Weather** | Open-Meteo API | Real-time forecasts (free, no key) |
| **Maps** | Google Maps JS API | Interactive location pins |
| **Auth** | Firebase Authentication | Google Sign-In (OAuth) |
| **Database** | Cloud Firestore | Real-time data sync |
| **Analytics** | Firebase Analytics | Usage tracking |
| **Deployment** | Google Cloud Run | Containerised serverless hosting |
| **Animations** | Framer Motion | Card carousel, modals, transitions |
| **Icons** | Lucide React | UI icons |
| **Styling** | Vanilla CSS | Comic/scrapbook design system |

---

## ☁️ Google Services Used

| # | Service | Role |
|---|---------|------|
| 1 | **Google Cloud Run** | Hosts the entire app — FastAPI backend + React frontend in one container |
| 2 | **Firebase Authentication** | Google OAuth Sign-In |
| 3 | **Cloud Firestore** | Real-time DB for users, friends, saved trips, shared trips |
| 4 | **Firebase Analytics** | User session and event tracking |
| 5 | **Google Maps JavaScript API** | Interactive per-day location map with markers and info windows |

---

## 📁 Project Structure

```
├── main.py                        # FastAPI app — routes, CORS, static serving
├── config.py                      # Settings loaded from env vars
├── models.py                      # Pydantic request/response models
├── security.py                    # Rate limiting, input sanitisation, CSP headers
├── requirements.txt               # Python dependencies
├── Dockerfile                     # Multi-stage build: Node → Python
│
├── services/
│   ├── orchestrator.py            # Coordinates weather + LLM calls
│   ├── llm_service.py             # Groq API integration + system prompt
│   └── weather_service.py         # Open-Meteo geocoding + forecast
│
├── frontend/
│   └── src/
│       ├── App.jsx                # Root — auth state, routing, custom cursor
│       ├── firebase.js            # Firebase init (Auth, Firestore, Analytics)
│       │
│       ├── pages/
│       │   ├── Landing.jsx        # Public landing page
│       │   └── Dashboard.jsx      # Main trip planning UI + carousel
│       │
│       ├── components/
│       │   ├── ItineraryMap.jsx   # Google Maps component (per-day pins)
│       │   ├── FriendSystem.jsx   # Send requests, view friends list
│       │   ├── Notifications.jsx  # Real-time friend request bell
│       │   ├── Navbar.jsx         # Sticky nav with auth controls
│       │   ├── Login.jsx          # Google Sign-In button
│       │   └── SettingsModal.jsx  # Profile update + account deletion
│       │
│       └── services/
│           └── firestoreService.js # All Firestore CRUD + real-time listeners
│
└── tests/
    ├── test_models.py
    ├── test_security.py
    └── test_weather.py
```

---

## 🚀 Local Development

### Prerequisites
- Python 3.11+
- Node.js 18+

### Backend
```bash
# Install dependencies
pip install -r requirements.txt

# Set env vars
cp .env.example .env
# Fill in: GROQ_API_KEY, GOOGLE_MAPS_API_KEY

# Run
uvicorn main:app --reload --port 8080
```

### Frontend
```bash
cd frontend
npm install
npm run dev
# Runs on http://localhost:5173, proxies /api to :8080
```

---

## ☁️ Cloud Run Deployment

```bash
gcloud run deploy travi \
  --source . \
  --region asia-south1 \
  --allow-unauthenticated \
  --set-env-vars "GROQ_API_KEY=<key>,GOOGLE_MAPS_API_KEY=<key>"
```

The Dockerfile handles everything:
1. **Stage 1** — Node 20: `npm ci` + `npm run build` → produces `dist/`
2. **Stage 2** — Python 3.11: installs deps, copies backend, copies `dist/` → `static/`
3. FastAPI serves React from `/static` and API from `/api`

---

## 🔒 Security

- No hardcoded API keys — all via environment variables
- Input sanitisation on all user-facing fields (XSS prevention)
- Rate limiting: 15 requests/minute per IP (sliding window)
- Security headers: CSP, X-Frame-Options, X-Content-Type-Options
- Non-root Docker user
- Google Maps API key served via `/api/maps-key` backend endpoint (not baked into JS bundle)

---

## 🧪 Tests

```bash
python -m pytest tests/ -v
```

---

## 👥 Team

Built at **PromptWars: Hyderabad** — Google for Developers × Hack2Skill

*Powered by Google Cloud ☁️ and way too much ☕*

## Ticket Booking (prototype)

Book bus, train and flight tickets for individuals or groups, in India and abroad, from the
**Book Travel** button on a generated itinerary (destination and dates are prefilled, with a
"Book return trip" shortcut).

- **Flow:** search → choose service/class → traveller details → simulated payment → ticket with PNR and seats; cancel with a refund per the policy (90% / 75% / 50% / 0% at 48h / 24h / 4h before departure; convenience fee is non-refundable).
- **Prototype data:** services, fares and availability are generated deterministically per route and date (`services/booking_catalog.py`) using fictional operators. Swap in real providers by replacing `search_options` / `get_option`.
- **Rules:** seats are held for 10 minutes; infants (<2) travel on a lap; international flights need a passport for each traveller; seats are never oversold (SQLite transactions).
- **Payment:** simulated only, with selectable success / decline / timeout outcomes. No card data is accepted.
- **Access:** bookings are tied to the contact email (`X-Contact-Email` header). Firebase token verification is a planned follow-up.
- **Config:** `BOOKING_DB_PATH` (default `data/bookings.db`, or `/tmp/travi_bookings.db` on Vercel). Storage is ephemeral on Render's free tier and per-instance on Vercel serverless, so bookings can reset on redeploy or when a cold instance starts. Fine for a demo; use a hosted database before real use.
- **API:** `GET /api/booking/locations`, `GET /api/booking/search`, `POST /api/bookings`, `GET /api/bookings`, `GET /api/bookings/{pnr}`, `POST /api/bookings/{pnr}/pay`, `POST /api/bookings/{pnr}/cancel`.
- **Tests:** `pytest tests/test_booking.py tests/test_places.py` (backend) and `cd frontend && npm test` (UI).

### Origin and place suggestions

- **Trip Details** has an optional **Starting from (origin)** field with worldwide suggestions as you type. It is sent with `/api/plan` and `/api/replan` (`origin`), so the itinerary accounts for the journey, shows "Starting from ...", and is stored with saved and shared trips. The last origin is remembered in the browser.
- **Book Travel** opens with the origin (and the exact place you picked) prefilled; the booking search's From/To boxes use the same suggestions. Any place in the world works: the curated catalog cities (airports/rail/bus hubs) come first, everything else is resolved through Open-Meteo's free geocoding API, so there is no extra API key and no dataset to maintain. If the geocoder is down, suggestions fall back to the catalog and typing free text still works.
- **API:** `GET /api/places/suggest?q=<text>&limit=8` returns `{places: [{label, name, region, country, country_code, lat, lng, value, kind}]}` (empty for queries under 2 characters; 90 requests/min per IP). `value` is a catalog code or a self-contained `geo:` token that `/api/booking/search` accepts as `origin`/`destination`, keeping option IDs stateless on serverless hosts.
- **Prototype limits:** places outside the catalog are treated as cities (no airport matching); places closer than 30 km are rejected as too close to book.


## Firebase setup checklist (project `travi-vibesprint`)

Login and saved/shared trips need three things in the Firebase console. The code only holds the public web config (`frontend/src/firebase.js`, overridable with `VITE_FIREBASE_*`).

1. **Authentication:** Build → Authentication → Get started → Sign-in method → enable **Google** (set a support email).
2. **Authorized domains:** Authentication → Settings → Authorized domains → add the Vercel domain (e.g. `travi-ai.vercel.app`). Preview deployments need their own entries. `localhost` is there by default.
3. **Firestore:** Build → Firestore Database → Create database (production mode), then publish the rules: `npx firebase-tools login && npx firebase-tools deploy --only firestore:rules` (uses `firebase.json`/`.firebaserc`), or paste `firestore.rules` into the console Rules tab.

Quick checks from a terminal (public web API key from `firebase.js`):

- Auth initialized? `curl "https://www.googleapis.com/identitytoolkit/v3/relyingparty/getProjectConfig?key=<apiKey>"` should list `authorizedDomains` (`CONFIGURATION_NOT_FOUND` means step 1 is missing).
- Firestore exists? `curl "https://firestore.googleapis.com/v1/projects/travi-vibesprint/databases/(default)/documents/users?pageSize=1&key=<apiKey>"` should return 403 (exists, rules deny anonymous access). A 404 `database does not exist` means step 3 is missing.
- Sign-in popup shows `auth/unauthorized-domain`? Step 2. `auth/configuration-not-found` or `operation-not-allowed`? Step 1.
