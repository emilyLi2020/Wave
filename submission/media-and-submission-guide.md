# WAVE — Media & Submission Mechanics Guide

**Owner:** Media & Submission-Mechanics Lead
**Hackathon:** Gemma 4 Good Hackathon — Track: **Health & Sciences**
**Hard deadline:** 2026-05-18 **23:59 UTC** (un-submit / edit / resubmit allowed until this instant; draft writeups are NOT judged)
**One Kaggle Writeup per team. A cover image is REQUIRED to submit.**

---

## Brand reference (pulled from the live app)

Use these exact values so all media reads as one product. Source: `client/app/globals.css` (`[data-wave-skin]`) and `client/app/page.tsx`.

| Token | Hex | Use |
|---|---|---|
| Deep-water base / background | `#02060d` | Canvas background, letterbox bars |
| Secondary deep indigo | `#05131f` | Gradient partner to base |
| Foreground text | `#f3faff` | Headlines, body |
| Accent (bioluminescent cyan) | `#22d3ee` | Product name, CTA, glow |
| Wave rise | `#5ce1d6` | Wave gradient start |
| Wave peak | `#22d3ee` | Wave gradient mid |
| Wave fall | `#b8fff2` | Wave gradient crest highlight |
| Accent soft halo | `rgba(34,211,238,0.14)` | Glow bloom behind name/wave |

- **Display type:** italic serif (Instrument Serif / fallback Times New Roman italic) — used for every hero + section head.
- **Label / meta type:** monospace, UPPERCASE, wide tracking (~0.18–0.22em) — used for kickers, track tags, "On-device" pill.
- **Voice (verbatim from app):** hero line "Something's rising. Let's watch it." / subhead "A wave you don't have to fight. Just watch it crest and pass."
- **Motif:** a single glowing horizontal wave on near-black water; soft cyan bloom; calm, not clinical.

---

## 1. COVER IMAGE

### Required spec
- **Status: REQUIRED.** Kaggle will not let you Submit the Writeup without a cover image. It is the thumbnail/banner shown in the gallery and on the Writeup header.
- **Recommended dimensions:** **1200 × 630 px** landscape (≈1.91:1). Safe everywhere Kaggle crops/scales; also doubles as the social/OG card.
- **Format:** PNG (crisp text) or high-quality JPG. Keep under ~2 MB.
- **Safe area:** keep all text within the center, ~80 px padding from every edge — Kaggle may crop edges to different aspect ratios in list views.
- **Legibility:** must read at ~320 px wide (gallery thumbnail). Headline ≥ ~64 px in the 1200-wide artboard; product name larger.
- **No login dependency:** it's a static image upload — but it must not contain PII or anything you can't make public.

### Concept A — "The Wave" (RECOMMENDED — fastest, most on-brand)
- **Layout:** full-bleed `#02060d` → `#05131f` vertical gradient. One glowing wave crest sweeping bottom-third, gradient stroke `#5ce1d6 → #22d3ee → #b8fff2` with a soft outer cyan bloom (`rgba(34,211,238,0.14)`, ~60 px blur).
- **Headline (italic serif, centered, upper-middle):** *Something's rising. Let's watch it.*
- **Subhead (sans, `#f3faff` at 70% opacity, below headline):** An offline-first, medication-aware urge-surfing companion for opioid & substance-use recovery.
- **Product name:** **WAVE** — top-left, mono-uppercase, wide tracking, `#22d3ee` with faint glow.
- **Track tag:** top-right, mono-uppercase pill, hairline `rgba(243,250,255,0.14)` border: `GEMMA 4 GOOD · HEALTH & SCIENCES`.
- **Footer strip (bottom, mono 10px uppercase, 55% opacity):** `RUNS ON-DEVICE · GEMMA 4 E2B + UNSLOTH LoRA · NO ACCOUNT · NO CLOUD`.

### Concept B — "Medication difference" (most differentiating message)
- **Layout:** split. Left 55%: dark water + wave. Right 45%: a single glass card (`rgba(8,22,38,0.62)`, 14px blur, hairline border) echoing the app's quote card.
- **Headline (left, italic serif):** *A 7 at hour 4 isn't a 7 at hour 22.*
- **Card text (right, sans):** "Your Suboxone is working right now. What you're feeling at a 7 would be a 9 or 10 without it." — with kicker `MEDICATION-AWARE · ON-DEVICE GEMMA 4`.
- **Product name + track:** **WAVE** top-left; `HEALTH & SCIENCES` track pill top-right.

### Concept C — "Ride / score arc" (product-proof, screenshot-driven)
- **Layout:** real session screenshot (the animated wave + intensity slider, or the post-7-session ScoreArc insight) bled to the right edge with a `#02060d` gradient scrim on the left for text.
- **Headline (italic serif, left):** *Watch the craving crest and pass.*
- **Subhead:** Three taps in. On-device AI. Your data, shown back to you.
- **Product name:** **WAVE** top-left; track pill `GEMMA 4 GOOD · HEALTH & SCIENCES` bottom-left, mono.
- **Treatment:** desaturate screenshot ~10%, push a cyan color-grade so it matches A/B if used in the same gallery.

### How to make it fast (pick ONE)

**Path 1 — Canva / Figma (≈15 min, most reliable):**
1. New design → custom size **1200 × 630 px**.
2. Background rectangle → linear gradient `#02060d` (top) → `#05131f` (bottom).
3. Add a wave: Canva "Elements" → search "glow wave line"; or Figma → pen a sine curve, stroke 6–10px, gradient `#5ce1d6 → #22d3ee → #b8fff2`, add a Layer Blur duplicate behind it for the bloom.
4. Text layers per Concept A. Headline = a serif italic font (Instrument Serif if available, else "DM Serif Display" italic / Times italic). Name + tags = a monospace font, ALL CAPS, letter-spacing ~3–4.
5. Set name/tags fill to `#22d3ee`; add a subtle outer glow.
6. Export PNG @ 1× → `submission/cover.png`.

**Path 2 — Generate from the app's own UI (≈10 min, most authentic):**
1. `cd client && pnpm dev` (or use the deployed live demo URL).
2. Open `/` (home) or `/session` mid-wave in a Chromium window sized to **1200 × 630** (DevTools → device toolbar → Responsive → set 1200×630).
3. Screenshot full viewport. The `[data-wave-skin]` canvas already renders the exact bioluminescent water + wave.
4. Drop the screenshot into Canva/Figma at 1200×630, add a dark scrim on the text side, overlay **WAVE** + headline + track pill (Concept C).
5. Export PNG → `submission/cover.png`.

**Path 3 — Emergency fallback (≈5 min):** solid `#02060d` background, centered italic-serif **WAVE** in `#22d3ee` with glow, subhead line, and the track pill. No wave art. Still passes the "required cover image" gate and stays on-brand. Better a clean text cover submitted than a perfect cover missed.

Save the final as `E:\Github\Wave\submission\cover.png` and keep the editable source (`.canva` link or `cover.fig`) noted in this folder.

---

## 2. MEDIA GALLERY — what to attach and in what order

Kaggle Writeup Media Gallery shows items in upload order. Lead with the strongest visual; the **video must be attached to the Media Gallery** (rule requirement).

1. **Cover image** (`cover.png`) — set as cover/first.
2. **Demo video** (YouTube link, ≤3 min) — attach to the Media Gallery (not just linked in body).
3. **Session walkthrough screenshot** — three-tap intake → animated wave + slider.
4. **Medication-aware acknowledgment screenshot** — the generated trauma-informed copy (the differentiator).
5. **Insight / ScoreArc screenshot** — "how much further cravings fall on medication days" after 7 sessions.
6. *(Optional)* Architecture diagram — on-device Gemma 4 E2B + Unsloth LoRA, no cloud.

Keep gallery to ~5–6 strong items. Every screenshot color-graded to the cyan/near-black palette so the set looks like one product.

---

## 3. YOUTUBE — upload checklist

> Rule: video ≤ **3:00**, hosted on YouTube, **viewable without login**, attached to the Media Gallery.

**Before upload**
- [ ] Final cut is **≤ 3:00** (aim 2:30–2:55; hard-trim if over — an over-length video risks disqualification).
- [ ] Shows: the problem → three-tap intake → ride-the-wave with narration → medication-aware copy → insight payoff. On-device emphasized.
- [ ] No PII, no copyrighted music (use YouTube Audio Library or silence/ambient).

**Upload settings**
- [ ] **Title:** `WAVE — On-Device, Medication-Aware Urge-Surfing for Recovery | Gemma 4 Good Hackathon`
- [ ] **Visibility: Public.** NOT Unlisted, NOT Private. (Unlisted can be missed by judges and may not satisfy "viewable"; Public is the safe choice. Set this explicitly on the last upload step and re-confirm after publish.)
- [ ] **"Made for Kids": No** (it's not child-directed; "Yes" disables key features and can hide it).
- [ ] **Description:** use the template below.
- [ ] **Thumbnail:** upload `cover.png` (or a 1280×720 variant) so the YouTube card matches the Kaggle cover.
- [ ] **Captions:** enable — upload an SRT or let YouTube auto-generate, then quick-correct the medication terms (Suboxone, Naltrexone) and the product name.
- [ ] **Category:** Science & Technology. **Comments:** on or off (either is fine).

**Description template** (paste, fill placeholders):
```
WAVE is an offline-first, medication-aware urge-surfing companion for people in
recovery from opioid and substance use disorder.

⚠️ On-device AI: the production app runs Gemma 4 E2B with an Unsloth LoRA
entirely on the user's phone. No account, no upload, no cloud — recovery data
never leaves the device.

Built for the Gemma 4 Good Hackathon — Track: Health & Sciences.

🔗 Code (public repo): <REPO_URL>
🔗 Live demo: <LIVE_DEMO_URL>

00:00 The problem
00:20 Three-tap intake
00:50 Ride the wave
01:30 Medication-aware acknowledgment
02:10 Your data, shown back
02:40 On-device & private

Crisis resources shown in-app: 988 Suicide & Crisis Lifeline ·
SAMHSA 1-800-662-HELP. This is a supportive tool, not medical advice.

#Gemma #OnDeviceAI #Recovery #HealthAI
```

**Post-publish verification (do this in a private/incognito window, logged OUT):**
- [ ] Open the YouTube URL — it plays with **no Google login prompt**.
- [ ] Visibility badge in YouTube Studio reads **Public**.
- [ ] Runtime shows **≤ 3:00**.
- [ ] Captions toggle works; thumbnail = cover.
- [ ] Copy the final watch URL for the Media Gallery + Writeup body.

---

## 4. KAGGLE SUBMISSION — click-by-click walkthrough

> Pre-req: **Kaggle account identity/phone verification must be completed before you can submit.** Do this FIRST (Kaggle → account Settings → Phone verification). Also confirm the **team is created/joined** and there is exactly **one** Writeup for the team — multiple drafts cause confusion; only the submitted one is judged.

1. Go to the hackathon's Kaggle competition page → **Writeups** tab → **New Writeup** (one Writeup per team — if a teammate already started one, edit THAT, do not create a second).
2. **Title:** `WAVE — On-Device, Medication-Aware Urge-Surfing Companion for SUD Recovery`.
3. **Subtitle / one-liner:** `Offline-first Gemma 4 E2B + Unsloth LoRA. Meets a craving in 30 seconds. No account, no cloud.`
4. **Body:** paste the finalized Writeup. **Confirm word count ≤ 1500 words** (paste into a counter first; trim the longest section if over).
5. **Select Track: Health & Sciences.** This is mandatory — a Writeup with no Track selected is not eligible. Double-check the dropdown/radio actually shows Health & Sciences saved.
6. **Media Gallery:** upload/attach in the order from §2 — **cover image first**, then attach the **YouTube video** to the gallery, then screenshots. Confirm the cover is set as the Writeup cover image (the required field).
7. **Attachments → Project Links:** add **Public code repo:** `<REPO_URL>` and **Live demo:** `<LIVE_DEMO_URL>`. (If demo files are needed instead of/in addition to a link, attach them under Files.)
8. **Save** the draft. Reload the page and visually confirm: title, body, track, cover, video, links all persisted.
9. **Submit** the Writeup (button is typically "Submit" / "Submit to competition"). If it's greyed out, the usual blockers are: no cover image, no Track selected, identity not verified, or not a team member.
10. **Verify the "Submitted" state:** the Writeup should now show a **Submitted** badge/status on the Writeups tab and/or your submission count reflects it. Take a screenshot of the Submitted state as proof.
11. **Re-submit workflow (if edits needed before 23:59 UTC):** open the Writeup → **Un-submit / Edit** → make changes → **Save** → **Submit** again → re-verify the Submitted badge. You may repeat this any number of times until the cutoff. **A writeup left in Edit/Draft after the cutoff is NOT judged** — always end on Submitted.

**Final pre-deadline verification checklist (run logged-out where possible):**
- [ ] Kaggle identity verification: **Verified**.
- [ ] Exactly **one** team Writeup; you are on the team.
- [ ] Track = **Health & Sciences** (saved & visible).
- [ ] Cover image present and looks correct in the gallery thumbnail.
- [ ] YouTube video attached to **Media Gallery**, **Public**, **≤ 3:00**, plays logged-out.
- [ ] Repo link opens publicly (test in incognito) and demo link loads.
- [ ] Body ≤ **1500 words**, renders correctly (no broken markdown/images).
- [ ] Writeup status = **Submitted** (screenshot saved).
- [ ] Submitted with comfortable margin before **23:59 UTC**.

---

## 5. Time-boxed countdown plan (working back from 23:59 UTC)

> Treat **22:30 UTC** as the real deadline. The last 90 minutes are buffer for the inevitable upload/verify snag. Submit a complete-but-imperfect package early, then iterate via the re-submit workflow.

| By (UTC) | Action | Owner |
|---|---|---|
| **T-7:00 (≈17:00)** | Kaggle **identity verification** confirmed; team created/joined; repo set public; live demo deployed & reachable. | User |
| **T-5:30 (≈18:30)** | Cover image final (`cover.png`) — Concept A via Path 1 or 2. Writeup body drafted & word-count-checked (≤1500). | Media Lead + writer |
| **T-4:00 (≈20:00)** | Demo video final cut ≤3:00 exported. | Video owner |
| **T-3:00 (≈21:00)** | YouTube upload **Public**, captions, thumbnail = cover; verified logged-out; URL captured. | User |
| **T-2:00 (≈22:00)** | Create/open the single Writeup; paste body; select **Health & Sciences**; upload cover + attach video + screenshots; add repo + demo links; **Save**. | User + Media Lead |
| **T-1:30 (≈22:30)** | **SUBMIT.** Verify **Submitted** badge. Screenshot it. — *primary deadline met here.* | User |
| **T-1:00 (≈23:00)** | Run the full pre-deadline checklist logged-out. Fix anything via Un-submit → Edit → Submit. | Media Lead + User |
| **T-0:20 (≈23:39)** | Final re-verify status = **Submitted**. Stop touching it unless broken. | User |
| **23:59** | Cutoff. Do nothing after this — no edits land. | — |

---

## USER ACTIONS (only the human can do these — in deadline order)

1. **NOW / by T-7h:** Complete **Kaggle account identity (phone) verification** — Kaggle Settings → Phone verification. Submission is blocked without it.
2. **By T-7h:** **Create or join the Kaggle team** and confirm there is exactly **one** team Writeup (don't spawn a duplicate). Make the **code repo public** and confirm the **live demo URL** is up.
3. **By T-5.5h:** **Make the cover image, or approve Concept A/B/C.** (Decision + asset can only be a human call; deliver `submission/cover.png`.)
4. **By T-4h:** Approve the **final demo video cut** (confirm it is ≤ 3:00).
5. **By T-3h:** **Upload the video to YouTube** set to **Public** (not Unlisted), add description (fill `<REPO_URL>` / `<LIVE_DEMO_URL>` + on-device disclaimer), thumbnail, captions; verify it plays **logged out**.
6. **By T-2h:** In the Kaggle Writeup: paste body, **select Track = Health & Sciences**, upload cover, **attach video to Media Gallery**, add repo + demo links under Project Links, **Save**.
7. **By T-1.5h (≈22:30 UTC):** Click **Submit**. Confirm the **"Submitted"** badge and screenshot it.
8. **By T-1h → T-0:20:** Run the logged-out verification checklist; if anything is wrong, **Un-submit → Edit → Save → Submit** again and re-verify. Ensure the final state is **Submitted** well before **23:59 UTC**.
