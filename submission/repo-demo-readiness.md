# WAVE — Repo & Demo Readiness Audit

Auditor: Repo & Demo Readiness Lead
Date: 2026-05-18 (deadline 2026-05-18 23:59 UTC)
Repo root: `E:\Github\Wave`
Origin: `git@github.com:emilyLi2020/Wave.git` — **PUBLIC** (verified: `gh repo view` → `visibility: PUBLIC`; anonymous `https://github.com/emilyLi2020/Wave` → HTTP 200)
Live demo: Vercel project `waves` (`prj_V2wLAL6095heoSADg93bpnnIonzn`, org `art3m1s`) → `[[USER: LIVE DEMO URL UNRESOLVED — [[USER: LIVE DEMO URL UNRESOLVED — waves.vercel.app is NOT our app (foreign squat); waves-art3m1s.vercel.app returns 401. Deploy client/ to a team-controlled Vercel domain with NO auth, verify anon 200 in incognito, then put THAT url here]] is NOT our app (foreign squat); waves-art3m1s.vercel.app returns 401. Deploy client/ to a team-controlled Vercel domain with NO auth, verify anon 200 in incognito, then put THAT url here]]` → HTTP 200

Overall: **Submittable with two required fixes** — (1) rotate the OpenAI key that sits in plaintext on disk, (2) add a LICENSE/NOTICE for the Gemma derivative. Git history is clean of secrets and the repo is already public. The rest is polish.

---

## 1. SECRETS SCAN (critical)

Method: regex sweep of working tree (Grep, gitignore-aware), explicit sweep of gitignored/untracked files, `git grep` over tracked files, `git log --all -p -S` history sweep across all branches, and a check of which `.env*` files are tracked.

### FINDING S-1 — Live OpenAI API key in `client/.env.local` (HIGH — rotate now)

- **File:line:** `E:\Github\Wave\client\.env.local:8`
- **Content:** `# OPENAI_API_KEY=sk-proj-cyqax8TYUAAl2zz...JNh3MC5YKofaD...Ik9wA` (full `sk-proj-` key, commented out)
- **Tracked in git?** NO. `client/.gitignore` has `.env*` with `!.env.local.example`, root `.gitignore` has `.env`/`.env.*`. Confirmed `git ls-files` does not list it; `git log --all` shows `.env.local` was never committed on any branch.
- **In git history?** NO. `git log --all -p -S 'sk-proj-'` and an all-branch grep returned nothing. The secret has never entered version control.
- **Why it still matters:** (a) The key is real, plaintext, on disk in the repo tree. (b) `models/finetune/generate_wave_session_synthetic.py:55` defaults its env path to `../client/.env.local`, and `load_api_key()` (lines 318–334) *strips a leading `#`* before parsing — so the commented line is still an active, working key for that script. (c) The exact file path is named in tracked docs (`models/finetune/README.md:138`, `SYNTHETIC_DATA.md:108`), pointing anyone at where the operator keeps it. A single accidental `git add -f` or a screen-share during the demo leaks it.
- **Remediation:**
  1. **Rotate immediately** at <https://platform.openai.com/api-keys> — revoke `sk-proj-cyqax8TY...`, issue a new key. Do this FIRST regardless of anything else.
  2. Delete the key line from `client/.env.local` (the synthetic-data run is one-time and already done; the in-browser Gemma stack is what ships, so no live key is needed for the demo).
  3. History scrub: **not required** — never committed.
  4. `client/.gitignore` already correctly ignores it; no change needed there.

### FINDING S-2 — `transformers` dummy token in vendored venv (NONE — false positive, note only)

- **File:line:** `E:\Github\Wave\models\.venv\Lib\site-packages\transformers\testing_utils.py:210` → `TOKEN = "hf_94wBhPGp6KrrTH3KDchhKpRxZwd6dmHWLL"`
- This is HuggingFace's well-known public CI placeholder shipped inside the `transformers` library, not a project secret. `models/.venv/` is gitignored (`.venv/` in root `.gitignore`) and not tracked. **No action.**

### Other patterns checked — all clean

- `sk-`, `sk-proj-`, `hf_…`, `AKIA…` (AWS), `ghp_…` (GitHub PAT), `xox[bapr]-…` (Slack), `AIza…` (Google), `BEGIN … PRIVATE KEY`: **no matches in tracked files or git history.**
- Supabase / `DATABASE_URL` / `SERVICE_ROLE` / `PASSWORD` / `BEARER`: only env-var *names* and `process.env.*` references in tracked code/docs — **no values**.
- Only tracked `.env*` file is `client/.env.local.example` — contains no secrets (only the `NEXT_PUBLIC_TRAINING_ENABLED` kill-switch and a commented optional path).
- `.vercel/` is gitignored; only `client/public/vercel.svg` (the logo) is tracked. No Vercel tokens in the tree.
- 853 tracked files reviewed; tracked `client/data/training-seeds/*.json` are clinical dataset seeds, no credentials.

**Net: the only real secret is S-1, and it is local-only (never committed). Rotate it, delete the line. No history rewrite needed.**

---

## 2. LICENSE & ATTRIBUTION (required fix)

- **There is NO LICENSE file at the repo root.** (`LICENSE`/`COPYING`/`NOTICE` not tracked; the only LICENSE files are inside vendored dependencies `.agents/skills/prompt-master/LICENSE` and `mobile/vendor/react-native-litert-lm/LICENSE` — not the project's own.)
- WAVE ships a **fine-tuned Gemma 4 E2B derivative** (merged Unsloth LoRA, Q4_K_M GGUF on HF `Maelstrome/lora-wave-session-r32`). Gemma is governed by the **Gemma Terms of Use** and the **Gemma Prohibited Use Policy**. Distributing a derivative requires (a) propagating the Gemma Terms, (b) a "built with / fine-tuned from Gemma" attribution, and (c) Gemma naming-guideline compliance (don't rename the base model away from "Gemma"; a derivative may be named anything but must attribute Gemma).

**Exact fix:**

1. Add a root `LICENSE` for the project's own code. Recommended: **Apache-2.0** (compatible with the Gemma terms, standard for ML repos). Put the team/author as copyright holder.
2. Add a root `NOTICE` (or a `## License & Model Attribution` section in the root `README.md`) with this text:

   > This product is built with and includes a derivative of **Gemma**.
   > Base model: Gemma 4 E2B (google), used under the **Gemma Terms of Use**
   > (https://ai.google.dev/gemma/terms) and subject to the **Gemma Prohibited
   > Use Policy** (https://ai.google.dev/gemma/prohibited_use_policy).
   > "Gemma" is a trademark of Google LLC. The fine-tuned adapter and merged
   > GGUF in `Maelstrome/lora-wave-session-r32` are a Gemma derivative and
   > remain subject to the Gemma Terms. WAVE project code (everything outside
   > the model weights) is licensed Apache-2.0.

3. Add the same attribution paragraph to the Hugging Face model card (`Maelstrome/lora-wave-session-r32` → `gguf/README.md`) and set the HF model license metadata to `gemma`. (Per MEMORY: never overwrite existing HF files — edit the card in place.)

---

## 3. README / DOCS QUALITY FOR AN OUTSIDE JUDGE

The docs are unusually strong. Root `README.md` and `client/README.md` clearly state what WAVE is, that all inference is on-device, the exact runtime (Gemma 4 E2B Q4_K_M GGUF via `@wllama/wllama`, WebGPU), the HF model path, json_schema decoding rationale, and how to run locally. `docs/models.md` and `docs/model-training.md` document the Gemma base, LoRA contracts, and training/eval pipeline. A judge can verify the demo is real.

**Concrete gaps + exact additions (keep short):**

- **G-1 (top of root README): a one-line "Try the live demo" link + caveat.** Judges should not have to build it. Add right under the title:
  > **Live demo:** [[USER: LIVE DEMO URL UNRESOLVED — [[USER: LIVE DEMO URL UNRESOLVED — waves.vercel.app is NOT our app (foreign squat); waves-art3m1s.vercel.app returns 401. Deploy client/ to a team-controlled Vercel domain with NO auth, verify anon 200 in incognito, then put THAT url here]] is NOT our app (foreign squat); waves-art3m1s.vercel.app returns 401. Deploy client/ to a team-controlled Vercel domain with NO auth, verify anon 200 in incognito, then put THAT url here]] → open **/session** in **Chrome/Edge desktop with WebGPU**. First load downloads a ~3.2 GB Gemma 4 GGUF into the browser (one-time, cached) — give it a few minutes on first run. No login, no install.
- **G-2: an explicit "How Gemma 4 is used" section** (judges grade this directly). 4 bullets: (1) base = Gemma 4 E2B; (2) fine-tuned with Unsloth QLoRA on the clinical `lora-wave-session` dataset, merged + quantized to Q4_K_M GGUF; (3) runs fully in-browser via wllama on WebGPU — no server inference; (4) used for phase narration, voice check-in turns, and the reflection card, with strict `json_schema` decoding and clinician-reviewed fallbacks. Point to `docs/models.md`.
- **G-3: LICENSE & Gemma attribution section** — see section 2 above (this gap is also a compliance requirement).
- **G-4: browser/hardware requirements block** — "Requires WebGPU (Chrome/Edge 113+, Safari 17+). ~3.2 GB first-load model download, cached after. ~4 GB free VRAM/unified memory recommended. iOS Safari works but is slower." Prevents a judge concluding the demo is broken when it's just downloading.
- **G-5 (optional): a 30–60s demo video link or GIF** in the README as a fallback if a judge's machine lacks WebGPU or patience for the download. Strongly recommended given G-1's caveat.

---

## 4. PUBLIC GITHUB REMOTE — STATUS

- `git remote -v` → `origin git@github.com:emilyLi2020/Wave.git`
- **Repo is already PUBLIC and anonymously reachable** (verified two ways). Default branch `main`. No login/paywall.
- Local `main` is **2 commits behind `origin/main`** (origin tip `4fda5f6`), and there are uncommitted working-tree changes (demo reskin / prompt registry). The *public* state judges see is `origin/main`, which is ahead of local — that's fine, nothing local is missing from public. Just make sure any final demo-affecting commits are pushed before the deadline.
- **No history scrub needed** — secret S-1 was never committed (confirmed all-branch `git log -p -S`). The public history is safe to expose as-is.
- Large vendored binaries are tracked (VAD/wllama WASM ~70 MB, LiteRT iOS frameworks ~90 MB). All under GitHub's 100 MB/file limit; acceptable, no action required for the deadline.

**Action needed to expose publicly without leaking:** none for visibility (already public). Only: push final commits to `origin/main`, and confirm `.env.local` is still untracked after any `git add` (it is gitignored, but use `git status` to be sure before the final push).

---

## 5. LIVE DEMO — DEPLOY PATH & UX CAVEAT

**Serving model:** Next.js 16 client in `client/`, deployed to **Vercel** (project `waves` already linked; `client/.vercel/project.json` present locally; `npx vercel ls` shows existing deployments; `[[USER: LIVE DEMO URL UNRESOLVED — [[USER: LIVE DEMO URL UNRESOLVED — waves.vercel.app is NOT our app (foreign squat); waves-art3m1s.vercel.app returns 401. Deploy client/ to a team-controlled Vercel domain with NO auth, verify anon 200 in incognito, then put THAT url here]] is NOT our app (foreign squat); waves-art3m1s.vercel.app returns 401. Deploy client/ to a team-controlled Vercel domain with NO auth, verify anon 200 in incognito, then put THAT url here]]` returns 200). This is the right path — static/SSR shell from Vercel, all model inference in the visitor's browser (wllama + WebGPU), GGUF streamed from the public HF CDN. No backend inference cost, no login.

**Big UX caveats to communicate to judges (and the fixes):**

1. **~3.2 GB GGUF in-browser download on first visit.** Five-shard Q4_K_M from `huggingface.co/Maelstrome/lora-wave-session-r32/gguf/`. Cached by the browser after first load but the first run is multi-minute on normal broadband. → Mitigate with README G-1/G-4 wording and a fallback demo video (G-5). Optionally pre-warm the deployed URL in the same browser you'll screen-share so the cache is hot during judging.
2. **WebGPU required.** Chrome/Edge 113+ or Safari 17+; no WebGPU = no demo. State this explicitly (G-4).
3. **Cross-origin isolation headers are production-only and scoped to `/models/*`** (`next.config.ts`). The patient-facing `/session` flow is the demo path and is not behind COEP — good. Don't point judges at `/models/*` dev pages.
4. **Developer "Training" UI gate.** `NEXT_PUBLIC_TRAINING_ENABLED` defaults to `true` in `.env.local`/`.env.local.example`; when not exactly `"true"` every `/training` + `/api/training` route 404s (`client/lib/training/guard.ts`). `npx vercel env ls` returned no configured env vars, so **the production deploy may currently expose the developer Training UI to judges**. This is not a secret leak (no credentials) but it's noise and a "this isn't the product" risk. → **Verify in the Vercel dashboard that `NEXT_PUBLIC_TRAINING_ENABLED` is unset or not `"true"` for Production, then redeploy.** Note it is `NEXT_PUBLIC_*`, so it is baked at build time — changing it requires a rebuild/redeploy, not just an env edit.

**Exact deploy steps for a public, no-login URL:**

```bash
# from E:\Github\Wave\client  (project already linked to Vercel project "waves")
npx vercel link --yes                       # confirm link if prompted
npx vercel env rm NEXT_PUBLIC_TRAINING_ENABLED production   # ensure dev UI is gated (ignore "not found")
npx vercel --prod                           # build + deploy production
# then verify:
#   [[USER: LIVE DEMO URL UNRESOLVED — [[USER: LIVE DEMO URL UNRESOLVED — waves.vercel.app is NOT our app (foreign squat); waves-art3m1s.vercel.app returns 401. Deploy client/ to a team-controlled Vercel domain with NO auth, verify anon 200 in incognito, then put THAT url here]] is NOT our app (foreign squat); waves-art3m1s.vercel.app returns 401. Deploy client/ to a team-controlled Vercel domain with NO auth, verify anon 200 in incognito, then put THAT url here]]/        -> 200, home loads, no login
#   [[USER: LIVE DEMO URL UNRESOLVED — [[USER: LIVE DEMO URL UNRESOLVED — waves.vercel.app is NOT our app (foreign squat); waves-art3m1s.vercel.app returns 401. Deploy client/ to a team-controlled Vercel domain with NO auth, verify anon 200 in incognito, then put THAT url here]] is NOT our app (foreign squat); waves-art3m1s.vercel.app returns 401. Deploy client/ to a team-controlled Vercel domain with NO auth, verify anon 200 in incognito, then put THAT url here]]/session -> patient flow, model download starts
#   [[USER: LIVE DEMO URL UNRESOLVED — [[USER: LIVE DEMO URL UNRESOLVED — waves.vercel.app is NOT our app (foreign squat); waves-art3m1s.vercel.app returns 401. Deploy client/ to a team-controlled Vercel domain with NO auth, verify anon 200 in incognito, then put THAT url here]] is NOT our app (foreign squat); waves-art3m1s.vercel.app returns 401. Deploy client/ to a team-controlled Vercel domain with NO auth, verify anon 200 in incognito, then put THAT url here]]/training-> client-side not-found (no training UI)
```

Vercel Project Settings → ensure no "Deployment Protection"/password is enabled (it isn't today — anon 200 confirms). Use the stable `[[USER: LIVE DEMO URL UNRESOLVED — waves.vercel.app is NOT our app (foreign squat); waves-art3m1s.vercel.app returns 401. Deploy client/ to a team-controlled Vercel domain with NO auth, verify anon 200 in incognito, then put THAT url here]]` alias in the submission, not a per-deploy `*-art3m1s.vercel.app` URL.

---

## USER ACTIONS — do this now (ordered)

1. **ROTATE THE OPENAI KEY FIRST.** Go to https://platform.openai.com/api-keys, revoke `sk-proj-cyqax8TY...`, create a replacement (or none — the demo doesn't need it). Then delete line 8 of `client/.env.local`. (Risk is low since it was never committed, but it is a live key in plaintext — do not skip.)
2. **Confirm nothing secret is staged before any push:** in `E:\Github\Wave` run `git status` and `git check-ignore client/.env.local` (must print the path = ignored). Never `git add -f` env files.
3. **Add LICENSE + attribution.** Create root `LICENSE` (Apache-2.0, team as copyright holder) and a root `NOTICE` (or README section) with the Gemma attribution block from section 2. Commit.
4. **Add README sections G-1, G-2, G-4** (live-demo link + caveat, "How Gemma 4 is used", browser/hardware requirements). Optional but recommended: G-5 demo video/GIF link. Commit.
5. **Push to public main:** `git push origin HEAD:main` (or merge your demo branch first). Repo is already public — verify the new commits show at https://github.com/emilyLi2020/Wave with no `.env.local`.
6. **Deploy the demo:** from `client/`, ensure `NEXT_PUBLIC_TRAINING_ENABLED` is not `"true"` in Vercel Production, then `npx vercel --prod`. Confirm Deployment Protection is OFF.
7. **Fresh-browser verification (incognito, not logged into GitHub/Vercel):**
   - https://github.com/emilyLi2020/Wave → loads, LICENSE + README visible, no login wall, no `.env.local` in the tree.
   - [[USER: LIVE DEMO URL UNRESOLVED — [[USER: LIVE DEMO URL UNRESOLVED — waves.vercel.app is NOT our app (foreign squat); waves-art3m1s.vercel.app returns 401. Deploy client/ to a team-controlled Vercel domain with NO auth, verify anon 200 in incognito, then put THAT url here]] is NOT our app (foreign squat); waves-art3m1s.vercel.app returns 401. Deploy client/ to a team-controlled Vercel domain with NO auth, verify anon 200 in incognito, then put THAT url here]] → home loads with no login; open `/session`, confirm the Gemma GGUF download begins and a chunk eventually narrates; confirm `/training` does NOT show the developer UI.
   - Time the cold model download once so you can set expectations in the writeup/demo.
8. **Pre-warm before judging:** load `[[USER: LIVE DEMO URL UNRESOLVED — waves.vercel.app is NOT our app (foreign squat); waves-art3m1s.vercel.app returns 401. Deploy client/ to a team-controlled Vercel domain with NO auth, verify anon 200 in incognito, then put THAT url here]]/session` once in the exact browser/profile you'll present from so the 3.2 GB model is cached and the live run is fast.
