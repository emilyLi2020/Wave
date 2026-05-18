# WAVE — Human-Drafted Demo Script (CANONICAL story/voice source)

> Authored by the team (Wenqing — therapist intern at Kaiser; Bill — engineering).
> This is the AUTHORITATIVE narrative voice, persona, and stats for the video VO
> and the writeup's Problem/Solution/Impact framing. AI artifacts must align to
> THIS, not invent a different story. Sections marked "Note for Bill" are tech
> gaps the engineer fills — the AI Kaggle writeup already covers these; map them.

## Opening / Human Need
I'm Wenqing. I'm a therapist intern at Kaiser. I see patients struggling with substance use every week, and they need more support. So Bill and I built WAVE — an offline AI companion that helps people ride out a drug or alcohol craving in real time, the way a trained clinician would.

Picture this. A forty-three-year-old man. Just lost his job. Drinking started as comfort, but soon became uncontrollable. Now a craving hits. His next therapy session is four days away. What can he do?

1 in 6 Americans meet the criteria for a substance use disorder, and only about 1 in 5 of those who need treatment receive it. There are barriers and stigmas getting in the way. But when a craving hits, the window to act is in a flash.

WAVE is built just for these moments.

## What WAVE Does
WAVE is a local AI companion that responds the way a skilled clinician would. It listens, adapts, and guides you through the craving in real time using urge surfing, grounded in Marlatt's Mindfulness-Based Relapse Prevention framework. Every phrase is shaped by real clinical scripts.

Unlike existing mindfulness apps, WAVE integrates therapeutic check-ins during the session — not before or after. No existing app is purpose-built around urge surfing or SUD recovery, and most still rely on pre-recorded libraries with no real-time responsiveness. WAVE attunes guidance based on the user's triggers and medication input. It understands what physical sensations and obstacles a user may face, drawing on training data provided by real clinicians and SAMHSA guidelines.

WAVE knows when the craving comes. Based on your history, WAVE's local scheduler fires a notification 15 minutes before a predicted risk window. Patient sees it on the lock screen: "Your history shows the next 2 hours can be challenging. Open WAVE now — before the wave builds." This is clinically significant. Instead of waiting for the user to open the app, WAVE intervenes before the craving peaks, at the moment of highest clinical leverage. If a session surfaces signs of acute crisis, a strict rule-based safety screen catches it immediately. WAVE does not offer medication advice. It knows its lane, and it stays in it.

WAVE is completely local. It stays on your device, no data or WiFi ever required. That is not just about confidentiality — it makes WAVE reachable for people with limited access to telehealth or internet-dependent apps. People who experience homelessness, rural communities without broadband, undocumented individuals who cannot risk cloud-based surveillance, and low-income workers who cannot afford consistent data plans can all benefit from WAVE.

## Why Gemma 4 (Note for Bill: add tech insights — Wenqing's understanding limited)
For users with no data, no WiFi, and no margin for error, connectivity cannot be a prerequisite for care.

Gemma 4 E2B-it runs entirely in the browser and on the edge device. WAVE's most sensitive interactions — a user disclosing triggers, medication, and logging a craving — never leave the phone. For populations carrying the dual stigma of financial instability and substance use, that is not a privacy feature. It is a precondition for trust.

Beyond privacy, Gemma 4 E2B-it gives WAVE the clinical precision the session architecture demands. Its structured output support enables strict schema adherence across intake forms, real-time check-ins, and reflection cards without external servers. Its adaptable tone lets WAVE mirror the measured, unhurried pacing of a trained clinician rather than the generic warmth of a wellness chatbot. Its local intelligence means the model understands context built across a session — sensations named, obstacles flagged, history carried forward — without a round trip. And because it runs at the edge, latency disappears. When the craving is cresting, WAVE responds in the moment.

## Technical Architecture (Note for Bill: left for engineer — AI writeup already has this)

## Model Training and Evaluation (Note for Bill: left for engineer — AI writeup already has this)

## Impact and Future (Note for Bill: highlight the fine-tune + hard work)
WAVE stands out through four core competencies: (1) clinically rooted, based on real observation of patient needs; (2) completely offline execution, expanding reach for marginalized groups; (3) absolute privacy; (4) moves beyond reactive intervention into proactive prevention.

The clinical landscape lacks products combining evidence-based urge surfing with the immediacy of local execution. The mobile roadmap transitions WAVE into a continuous support system: by securely analyzing encrypted session history natively on-device, it learns unique craving patterns, foreseeing when an urge is likely and sending gentle local notifications before a crisis — building resilience ahead of the urge, entirely outside the cloud.

---
### Integration mapping (for the submission team)
- VIDEO VO → adopt THIS voice/persona (Wenqing, first person) + stats (1-in-6 / 1-in-5). Replace generic VO.
- WRITEUP Problem/Solution/Impact → align to this framing; keep the AI writeup's verified technical sections to fill Wenqing's "Note for Bill" gaps (architecture, training/eval, why-Gemma-4 tech depth).
- New concrete assets to thread everywhere: the 43-year-old persona; the lock-screen pre-craving notification; the marginalized-population reach list; "knows its lane" safety framing.
