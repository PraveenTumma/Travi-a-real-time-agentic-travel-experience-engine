# Travi! — Pitch notes for the judges

**One-liner:** Travi! is an AI travel planner that builds your trip around the real weather, then re-plans it in seconds when things go wrong. Plans can be shared with friends.

Suggested stage flow (about 3 min): **Problem (30s) → Live demo (90s) → Impact and how we measure it (30s) → What's new about it (30s)**

---

## 1. Customer understanding

**The problem:** Planning a trip means 10+ browser tabs: blogs, Maps, weather, reviews, WhatsApp group chats. The plan is static. When it rains, a museum is shut, or a flight is late, you are re-planning on your phone, in the moment, under stress.

**Why it's worth solving**
- Planning takes hours, and most of it is busywork: checking what's open, what's near what, what fits the budget, and whether it will rain.
- Generic AI chat gives you a wall of text. It isn't on a map, doesn't know the forecast, and you can't hand it to your group.
- Plans break on the day. Nobody offers a good "Plan B" button.

**Who it's for (target users)**
- **Primary:** Indian travellers aged 20–35 planning short leisure trips (2–5 days, e.g. Goa, Hampi, Coorg, or a first international trip). Smartphone-first, budget-aware, travelling with friends or a partner.
- **Secondary:** families with constraints (kids, elderly parents, accessibility, vegetarian or Jain diets) for whom a generic itinerary fails.
- **Why them:** they plan in group chats (hence WhatsApp sharing), care about cost, and get hit hardest by monsoon weather.

**What we heard / assumptions to validate:** the pain is coordination (getting the group to agree) and disruption (plans breaking), not just inspiration.

## 2. Potential impact and how we'll measure it

**Impact**
- Cuts trip planning from hours to under a minute for a first draft.
- Fewer ruined days: weather-aware scheduling plus one-tap re-plan.
- Inclusive by default: accessibility, walking limits and dietary needs are first-class inputs, not afterthoughts.

**How we'll measure it (the metrics we'll instrument)**

| Metric | What it tells us | Target for the first pilot |
|---|---|---|
| Time to first itinerary | Speed vs. manual planning | < 60 s |
| Plan → Save rate | Is the plan good enough to keep? | > 40% |
| Re-plan usage per trip | Do people rely on the "Plan B" feature? | ≥ 1 per trip |
| Shares per saved trip (WhatsApp / friends) | Group value, viral loop | > 1 |
| Day-of return rate | Used *during* the trip, not just before | > 30% |
| Post-trip rating "plan matched reality" | Quality and trust | ≥ 4/5 |

Pilot plan: 50 users from our network and college travel groups over 2 weeks. Track the funnel in Firebase Analytics, which is already integrated, plus a one-question post-trip survey.

## 3. Readiness

**Working today (demo-able now)**
- Google sign-in (Firebase Auth) and a live web app (React frontend on Vercel, FastAPI backend on Render).
- AI day-by-day itinerary from destination, dates, budget, traveller type, interests, walking limit, accessibility, and diet.
- **Real weather** (Open-Meteo forecast) feeds the plan: indoor activities on rainy days.
- Every activity and meal **pinned on Google Maps**, day by day, in a swipeable card carousel.
- **One-tap re-plan** for disruptions: rain, closure, flight delay, feeling unwell.
- **Travi AI chat** that answers questions about your own itinerary (budget, rainy days, must-dos).
- Save trips, add friends, share trips in-app with real-time notifications.
- **WhatsApp share in one tap:** the green WhatsApp button on the itinerary header sends a formatted trip summary (day themes, and every activity for short trips) into WhatsApp. The user picks the group and hits send. No WhatsApp API or Meta approval needed.

**Honest gaps / next 2 weeks**
- WhatsApp share is a one-way text snapshot. It doesn't update when the plan changes, and friends can't edit it in Travi.
- WhatsApp clicks aren't tracked yet. Firebase Analytics is initialised, but no custom events are logged, so the "shares per saved trip" metric needs a `logEvent` on the button.
- Moving the AI to stronger models through RouterPlus (Claude / GPT) for better, more reliable plans (in progress today).
- Re-plan that edits only the affected day and shows what changed.
- Verifying places and coordinates against Google Places (today the AI suggests them).
- Weather beyond 16 days (fall back to climate averages).

**Ready to test with users: yes.** It's a public URL with Google login, works on desktop, and has a mobile layout.

## 4. Creativity: what's new here

- **A plan that reacts.** Most tools stop at "here's your itinerary". Travi treats the plan as live: real forecast in, disruption in, new plan out.
- **Constraint-first planning.** Walking limit, wheelchair access and diet shape the plan instead of being filtered afterwards.
- **Social by design.** Friends, in-app sharing and WhatsApp hand-off, because trips are planned in groups.
- **A product people remember.** A hand-drawn "doodle travel journal" interface, not another grey dashboard.
- **Grounded AI chat.** The assistant only answers from *your* itinerary, so it doesn't make up a different trip.

---

## Demo script (90 s)

1. Log in with Google. Point out the doodle-journal look.
2. Plan **"Goa, India"** for 3 days within the next week: budget level, couple, *street food + nature*, vegetarian, 8 km walking. Hit Generate.
3. Walk the day cards. Show the **weather note** and the **map pins** for that day.
4. Hit **"Heavy rain expected tomorrow"**. The plan moves indoors. *This is the hero moment.*
5. Ask the chat: *"What's my total budget?"* or *"Which day is rainy?"*
6. Hit the green **WhatsApp** button. WhatsApp opens with the trip summary pre-filled. Pick the group and send, so the whole group sees the plan. Close: "Plan in a minute, Plan B in a second, and your whole group is in."

**Before going on stage:** open the app 2–3 minutes early to wake the Render backend (it sleeps when idle). Pick dates within the next 16 days so weather shows. Keep one saved trip ready as a fallback in case the AI call is slow.
