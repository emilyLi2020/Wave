# WAVE — 3-Minute Submission Video Script

Gemma 4 Good Hackathon · Health & Sciences · Max 180s · YouTube (public)

This script is built ONLY from screens that exist in the live app
(`client/app/page.tsx`, `client/app/session/*`, `client/app/dashboard/page.tsx`).
Every shot below is recordable in a browser today. Total runtime target: **~178s** (under the 180s hard cap).

Voice is **Wenqing's** — first person, a therapist intern at Kaiser who, with
Bill (engineering), built WAVE. The narration uses the canonical persona,
framing, and stats from `submission/human-demo-script.md`.

---

## 1. Logline + Tone

**Logline:** When a craving crests and there's no one to call, WAVE is a
private, offline urge-surfing companion — powered by Gemma 4 running entirely
on the person's own device — that meets them in the under-ten-minute window
that decides everything.

**Tone:** Calm, human, unhurried, quietly confident. Not a fear ad, not a
hype reel. The pacing should feel like the app itself: slow breath in, slow
breath out. Think a documentary opening, not a startup sizzle. Bioluminescent
oceanic palette throughout (deep teal/ink, glowing crest). One voice, no
shouting. Let silence and the wave do work.

---

## 2. Narrative Arc

1. **Hook — the shock + the shift (0:00–0:18):** Lead with the number, not
   a person introducing herself. 1 in 6 Americans meet criteria for a
   substance use disorder; only about 1 in 5 who need treatment get it. And
   when a craving crests, the window to act is under ten minutes — but the
   next session is days away. *That* gap is the whole problem.
2. **Stakes (0:18–0:40):** Wenqing names herself and the cost. A
   forty-three-year-old patient, just lost his job, a craving hitting now,
   four days from his next session — the minutes between care are where
   recovery is lost or held. So Bill and I built WAVE.
3. **WAVE in action — the centerpiece (0:40–1:58):** Open the app. Three
   taps — intensity, medication, trigger. A rule-based safety check (before
   any model runs). A narrated urge-surfing chunk on a living wave. The
   in-session check-in distinction — therapeutic check-ins *during* the
   session, spoken, adaptive, medication-aware. The craving arc bends down.
   Reflection.
4. **Brief how-it-works / why Gemma 4 (1:58–2:32):** This isn't a cloud
   chatbot. Gemma 4 E2B plus an Unsloth LoRA runs in the browser via
   WebGPU — on-device is the precondition for trust, and edge latency means
   WAVE responds at the moment of need. The dashboard shows the payoff:
   cravings fall further on medication days. The pre-craving lock-screen
   notification and the marginalized-reach point land here.
5. **Vision close (2:39–2:58):** "Imagine the minutes between care are no
   longer the minutes recovery is lost." It knows its lane, built for the
   people telehealth can't reach, in the exact minute it matters. Not a
   replacement for care — a bridge to the next safe minute.

---

## 3. Second-by-Second Storyboard

> Times are cumulative. "VO" = voiceover. On-screen text = burned-in caption
> (keep short, high-contrast). All app shots are pre-recorded screen capture;
> the editor speed-ramps the long meditation pauses.

| Timecode | On-screen visual / shot | On-screen text | Voiceover |
|---|---|---|---|
| 0:00–0:07 | Black. Slow fade to the home screen's dark ocean canvas, wave faintly rising. No UI yet. | `1 in 6 Americans meet SUD criteria.` | "One in six Americans meet the criteria for a substance use disorder. Only about one in five who need treatment ever get it." |
| 0:07–0:18 | The wave continues to rise. Hold on emptiness; the caption swaps. | `The craving window: under 10 minutes. The next session: days away.` | "And when a craving crests, the window to act is under ten minutes. The next appointment is days away. That gap — those minutes between care — is where recovery is lost." |
| 0:18–0:28 | Cut to home screen fully loaded — headline "Something's rising. Let's watch it.", Begin button, the 988 / SAMHSA line visible. | `Wenqing · therapist intern, Kaiser` | "I'm Wenqing, a therapist intern at Kaiser. I see this gap every week — patients who need more support than a calendar can give them." |
| 0:28–0:34 | Same ocean. A soft caption types in. | "A 43-year-old patient. Just lost his job." | "A forty-three-year-old patient. Just lost his job. Drinking started as comfort, then it wasn't. A craving hits now." |
| 0:34–0:40 | Slow push toward the "Begin" button; cursor hovers. | "His next session is 4 days away." | "Four days until his next session. So Bill and I built WAVE." |
| 0:40–0:48 | Click "Begin". Intake screen: Question 1, tap intensity **7**. | "Three taps. No typing." | "WAVE opens straight into the moment. Three taps, no typing." |
| 0:48–0:55 | Tap MAT = "Buprenorphine / Suboxone"; Q3 appears, tap "Yes, on time". | — | "How strong it is. What medication you're on. Whether you took today's dose." |
| 0:55–1:01 | Tap trigger "Stress / emotions"; click "Continue". | — | "What set it off. About thirty seconds, because thinking clearly is hard right now." |
| 1:01–1:09 | Safety screen: "Have you used any substances today?" tap **No**. Flow continues. | "Safety check runs BEFORE any AI." | "First, a safety check. It's rule-based, and it runs before a single model does. Crisis routing is never left to AI." |
| 1:09–1:23 | Chunk player: glowing progress bar, "CHUNK 1 OF 5 · SETTLE", medication-aware banner visible ("Your Suboxone is in your system right now…"), italic narration line, wave behind. | "Medication-aware · Suboxone" | "Then the session begins — evidence-based urge surfing, grounded in Marlatt's relapse-prevention framework. It speaks to your actual chemistry, not a generic script." |
| 1:23–1:32 | Breath overline "Breathe in · 4s" then the narration line changes; wave swells with the count. (Editor speed-ramps pauses.) | — | "Notice the wave. You don't fight it. You watch it crest." |
| 1:32–1:50 | Voice check-in screen: animated wave, "Check-in 1 of 5". Mic level meter moves; a patient bubble "Maybe a seven" then an agent bubble with adaptive, warm copy. | "Check-ins DURING the session." | "Here's what no other app does: it checks in *during* the session, not before or after. Out loud. It hears the number and meets you there — no shame, no form." |
| 1:50–1:58 | Wave height label drops; later check-in bubble shows a lower number. Quick montage of 2 short check-in turns. | — | "Chunk by chunk, it stays with you while the wave passes." |
| 1:58–2:08 | Reflection screen: ScoreArc sparkline `7 → 2`, reflection card headline "Your craving fell 5 points across the session." | "7 → 2" | "And you can see it. The craving you walked in with, and where it ended. You stayed. It passed." |
| 2:08–2:16 | Done screen: "You stayed with it." with Duration + Intensity `7 → 2`. | "Lock screen, 15 min before risk." | "And WAVE doesn't only wait for you — based on your history, it sends a lock-screen notification fifteen minutes before a predicted risk window. Before the wave builds." |
| 2:16–2:27 | Cut to a clean architecture caption over the ocean: the on-device stack. | `Gemma 4 E2B + LoRA → WebGPU → in the browser. No cloud.` | "None of this touched a server. Gemma 4 E2B, with an Unsloth-trained adapter, ran entirely in your browser — and edge latency means WAVE answers the moment the craving crests." |
| 2:27–2:39 | Dashboard page: "Average intensity drop", and side by side "Medication-day drop" vs "Non-medication drop" stat cards. | "Reaches who telehealth can't." | "On-device isn't a privacy feature. It's a precondition for trust — and it reaches people telehealth can't: rural, undocumented, unhoused, low-income. Cravings fall further on medication days." |
| 2:39–2:55 | Slow pull back to the home ocean, wave settling flat. WAVE wordmark. | "Imagine: the minutes between care, no longer lost." | "WAVE gives no medication advice. It knows its lane. Imagine a world where the minutes between care are no longer the minutes recovery is lost — where a bridge to the next safe minute is always within reach." |
| 2:55–2:58 | End card: logo + links. | `WAVE · github.com/emilyLi2020/Wave · [[USER: LIVE DEMO URL UNRESOLVED — waves.vercel.app is NOT our app (foreign squat); waves-art3m1s.vercel.app returns 401. Deploy client/ to a team-controlled Vercel domain with NO auth, verify anon 200 in incognito, then put THAT url here]]` | (silence / soft ambient tail) |

Runtime: **~178s** (storyboard ends 2:58, under the 180s hard cap). Trim
the 1:50–1:58 montage first if you run long.

---

## 4. Full Voiceover Script (continuous prose)

> Read slowly. ~2.0–2.2 words/sec at this calm pace. Pause on the line
> breaks. **Word count: 389 words** (≈ 2:55 at narration pace, leaving a
> ~3s ambient tail; matches the storyboard end timecode under the 180s
> cap). Voice: Wenqing, first person.

One in six Americans meet the criteria for a substance use disorder. Only
about one in five who need treatment ever get it. And when a craving crests,
the window to act is under ten minutes — but the next appointment is days
away. That gap, those minutes between care, is where recovery is lost.

I'm Wenqing, a therapist intern at Kaiser. I see this gap every week —
patients who need more support than a calendar can give them. A
forty-three-year-old patient. Just lost his job. Drinking started as
comfort, but soon it wasn't. A craving hits now, and his next session is
four days away. So Bill and I built WAVE.

WAVE opens straight into the moment. Three taps, no typing. How strong it
is. What medication you're on. Whether you took today's dose. What set it
off. About thirty seconds, because thinking clearly is hard right now.

First, a safety check. It's rule-based, and it runs before a single model
does. Crisis routing is never left to AI.

Then the session begins — evidence-based urge surfing, grounded in Marlatt's
relapse-prevention framework. It speaks to your actual chemistry, not a
generic script. Notice the wave. You don't fight it. You watch it crest.

And here's what no existing app does: WAVE checks in *during* the session,
not before or after. Out loud. You answer out loud. It hears the number and
meets you there — no shame, no form. Chunk by chunk it stays with you while
the wave passes. You can see it: the craving you walked in with, and where
it ended. You stayed. It passed.

And WAVE doesn't only wait for you. Based on your history, it sends a
lock-screen notification fifteen minutes before a predicted risk window —
before the wave builds.

None of this touched a server. Gemma 4 E2B, with an Unsloth-trained adapter,
ran entirely in your browser, on your device. On-device isn't a privacy
feature — it's a precondition for trust, and edge latency means WAVE answers
in the moment the craving crests. It reaches people telehealth can't: rural,
undocumented, unhoused, low-income.

WAVE gives no medication advice. It knows its lane. Imagine a world where
the minutes between care are no longer the minutes recovery is lost — where
a bridge to the next safe minute is always within reach.

---

## 5. Screen-Capture Shot List (record from the live demo)

Run `cd client && pnpm dev`, open `http://localhost:3000` in a **clean
Chrome profile** (WebGPU enabled, no extensions, large cursor, zoom so text
is readable at 1080p). Record at the resolutions in section 7. Capture each
clip as a separate take so you can re-do one without re-running the session.

**TIP:** On the intake screen, flip the dashed **"Demo mode"** toggle ON
before answering. It collapses every meditation pause to ~2 seconds so the
full 5-chunk + 5-check-in arc records in ~2 minutes instead of 12–15. You
still get real Gemma narration and real check-ins — only the silent pauses
shrink. Hide the toggle in framing or trim that frame out.

| # | Screen / flow | Exactly what to click | Framing notes |
|---|---|---|---|
| S1 | **Home / landing** (`/`) | Just load it; let the wave animate ~6s. Slow-scroll once to reveal the "What WAVE does" cards and the privacy pledge, then back to top. | Full-window. Hold on the headline "Something's rising. Let's watch it." and the 988/SAMHSA line. This is your opening + closing footage. |
| S2 | **3-tap intake** (`/session`) | Click **Begin**. On intake: toggle **Demo mode** ON. Q1: tap **7**. Q2 MAT: **Buprenorphine / Suboxone**. Q3: **Yes, on time**. Q4 trigger: **Stress / emotions**. Click **Continue →**. | Record the taps slowly with ~1s between each — the highlight states (accent fill) read well on camera. Keep cursor visible. |
| S3 | **Safety screen** | "Have you used any substances today?" → tap **No**. | Short clip (~4s). The point is the caption "runs before any AI". |
| S4 | **Session chunk playing** | Let `loadingChunk` breath orb show briefly, then Chunk 1 plays. Capture: the medication-aware banner ("Your Suboxone is in your system…"), the progress bar, a "Breathe in · Ns" overline, and at least one narration line change. ~25–35s of raw footage. | This is the hero beat. **The medication-aware banner auto-dismisses after ~7s — capture it in the first seconds of Chunk 1, or grab a still immediately.** Don't click Skip — let Kokoro narrate at least 2 lines. |
| S5 | **AI check-in exchange** | When the voice check-in opens, click **Start check-in**. Speak: *"Maybe a seven."* Wait for the spoken agent reply + chat bubble. Do one more short turn (e.g. *"It's a little lower, maybe a five."*). | Capture the mic level meter moving, both chat bubbles, and the "Wave height: N/10" label changing. If mic is awkward, see VO note — you can record the screen and dub. Aim for the agent's first 1–2 sentences being visible/legible. |
| S6 | **Craving-drop arc / reflection** | Let the session reach the Reflection screen (Demo mode makes this ~2 min). Capture the **ScoreArc** sparkline and the reflection headline. Then click a next-step or type a short plan → reach the **Done** screen ("You stayed with it." + Duration + `7 → 2`). | The ScoreArc going down is the emotional payoff. Hold ~4s. |
| S7 | **Dashboard** (`/dashboard`) | Load it. Slow-pan/scroll over the four stat cards, especially **Medication-day drop** vs **Non-medication drop** side by side. | "Adherence made visible" caption goes here. Hold on the two contrasting numbers. |

Total raw capture needed: roughly 4–6 minutes of footage to cut down to ~178s.

---

## 6. B-roll / Cutaways · Visual & Music Notes

**B-roll / cutaways (all optional, app footage can carry the whole video):**
- The home-screen wave canvas with no UI — perfect for the cold open and
  the close; let it loop under the title cards.
- A single architecture caption built in your editor over the ocean (text
  only, see Timecode 2:18). Do NOT make a busy diagram — one line:
  `Gemma 4 E2B + LoRA → WebGPU → runs in the browser. No cloud.`
- Optional 1–2s of a hand setting a phone face-down on a table to imply
  "private / offline / alone" — only if you can shoot it tastefully. Skip
  pills, syringes, sad-stock-recovery imagery (explicitly avoid per
  submission rules).

**On-brand visual notes:**
- Palette: deep ink/teal background, glowing cyan crest (`#5CE1D6`-ish).
  Keep captions in near-white with subtle glow; never pure-white boxes.
- Typography for captions: a light serif for emotional lines (mirrors the
  app's italic-serif headlines), a mono/uppercase tracked style for the
  technical/label captions (mirrors the app's eyebrow style). Two styles
  max.
- Motion: slow cross-dissolves only. No whip-pans, no zoom punches, no
  glitch transitions. Let the wave animation be the only fast-ish motion.
- Burn in the key captions (judges may watch muted first); keep them ≤ 7
  words.

**Music / pacing:**
- One ambient/cinematic-calm track, low and constant. Bring it up ~2dB at
  the 1:08 "session begins" beat and again at 2:18 "none of this touched a
  server", duck it under VO everywhere. Fade to near-silence on the end
  card.
- The app itself has an ambient ocean audio bed during sessions — you can
  let a few seconds of the real captured app audio breathe under S4/S5
  instead of music for authenticity, then return to the music track.
- Target VO level ~ -3 dB, music bed ~ -18 dB under VO.

---

## 7. HOW TO RECORD THIS (non-filmmaker guide)

**A. Tools**
- **Screen capture:** OBS Studio (free, Win/Mac/Linux). Or macOS built-in
  `Cmd+Shift+5`. OBS preferred for clean 1080p60 and audio control.
- **Edit:** CapCut (free, easy), DaVinci Resolve (free, more control), or
  iMovie. Any timeline editor with audio ducking works.
- **VO mic:** phone earbuds with a mic, or laptop mic in a quiet, soft room
  (closet with clothes works great). Record VO separately from screen.

**B. Capture settings**
- Resolution **1920×1080**, **60 fps** (smooth wave), MP4/H.264.
- Browser: Chrome, **clean profile**, no extensions, dev tools closed,
  bookmarks bar hidden. Enable large cursor (OS accessibility) so clicks
  read on camera. Zoom the page so body text is legible at 1080p.
- Confirm WebGPU works: the session must actually run Gemma. If the model
  fails to load, the app falls back to scripted copy — still fine to film,
  but real Gemma narration is more convincing. Give it the first-load time.

**C. Clean audio**
- Record the VO as one continuous take reading section 4; do 2–3 takes,
  keep the calmest. Room tone matters more than gear — kill echo and fans.
- Record the app's S4/S5 audio (Kokoro narration + check-in voice) by
  capturing desktop audio in OBS so you have the option to use it.

**D. Rough edit order**
1. Lay the VO on the timeline first; it's the spine.
2. Drop S1 (home/wave) under the 0:00–0:38 hook.
3. Place S2 → S3 → S4 → S5 → S6 to match the VO beats (speed-ramp the
   meditation pauses 2–4× so they're brief).
4. Add the architecture caption card (2:18) and S7 dashboard (2:30).
5. Close on S1 wave settling + WAVE wordmark + links end card.
6. Add the music bed, duck under VO, fade out.
7. Burn in the captions from the storyboard's "On-screen text" column.
8. Watch once on a laptop and once on a phone. Trim to ≤ 180s (target 175).

**E. Free music sources**
- YouTube Audio Library (filter: Ambient / Calm, "no attribution required").
- Pixabay Music, Free Music Archive (check CC license = free + commercial),
  Uppbeat (free tier with the provided code). Pick one calm ambient track;
  keep a note of the license/attribution string for the description.

**F. Export settings**
- MP4, H.264, 1920×1080, 60 fps (or 30 if file is huge), ~12–16 Mbps,
  AAC audio 320 kbps. Aim < 500 MB.

**G. YouTube upload settings**
- Visibility: **Public** (or Unlisted only if Kaggle confirms unlisted is
  accepted — Public is the safe default; must be viewable with no login).
- **Title:** `WAVE — Offline, Medication-Aware Urge Surfing with Gemma 4`
- **Description:**
  ```
  WAVE is an offline-first, medication-aware urge-surfing companion for
  Substance Use Disorder recovery. Gemma 4 E2B + an Unsloth-trained LoRA
  run entirely on-device in the browser (WebGPU) — no account, no cloud,
  no session data leaving the device.

  Gemma 4 Good Hackathon — Health & Sciences.

  Code: https://github.com/emilyLi2020/Wave
  Live demo: [[USER: LIVE DEMO URL — deploy client/ to a team-controlled Vercel domain with NO auth, verify anon 200 in incognito, then paste that URL here. Do NOT use waves.vercel.app]]
  Built with Gemma 4 E2B-it + Unsloth (QLoRA).

  WAVE is a support prototype, not a replacement for clinical care.
  In crisis: call or text 988 · SAMHSA 1-800-662-HELP.

  Music: [[USER: music attribution — track name / source / license]]
  ```
- Category: Science & Technology. Add captions (upload your caption file or
  let the burned-in captions stand; auto-CC is a nice extra).
- After publishing, open the link in an **incognito window** to confirm it
  plays with no login. Paste the final URL into the Kaggle Writeup + media
  gallery.

---

## USER ACTIONS

**1. Record these 7 clips (live app, `pnpm dev`, clean Chrome, Demo mode ON):**
- **S1** Home/landing wave (~10s, used for open AND close).
- **S2** 3-tap intake: Begin → intensity **7** → **Suboxone** → **Yes, on
  time** → trigger **Stress / emotions** → Continue.
- **S3** Safety screen: "used substances today?" → **No** (~4s).
- **S4** Chunk 1 playing — get the medication-aware banner + a "Breathe in"
  overline + a narration line change (~30s).
- **S5** Voice check-in: **Start check-in**, say "Maybe a seven," then a
  lower number; capture both chat bubbles + the mic meter.
- **S6** Reflection ScoreArc `7 → 2` + Done screen "You stayed with it."
- **S7** Dashboard: medication-day vs non-medication drop cards.

**2. Voiceover decision — RECORD YOURSELF (recommended).** A calm human
voice is worth points on "Video Pitch & Storytelling" and matches the
empathetic subject; a quiet room + phone earbuds is enough. **This is
Wenqing's voice — read it first person.** Read section 4 verbatim (389
words, ~2:55). **Fallback if you can't get clean audio:** use
the app's own Kokoro TTS — paste section 4 into a Kokoro test surface, or
use any free TTS — but a real voice is better here. Do NOT leave it
silent/text-only.

**3. Edit** in CapCut/Resolve/iMovie following section 7D (VO first, app
clips to the storyboard beats, speed-ramp pauses, music bed ducked under VO,
burn in captions). Keep it **≤ 180s** (target 175).

**4. Upload to YouTube** as **Public**, title and description from section
7G (repo and demo URLs are already filled in; only fill the music
attribution: `[[USER: music attribution]]`). The final YouTube link is
`[[USER: YouTube URL]]` — verify it in an **incognito window**, then add
that URL to the Kaggle Writeup and media gallery.
