-- ============================================================================
-- 002_check_ins.sql
--
-- Adds the multi-turn check-in tables introduced by the five-chunk session
-- rewrite (PRD § Data Model). One `check_ins` row per check-in (5 per
-- completed session), and one `check_in_turns` row per chat turn (typically
-- 9-11 per check-in: 5 agent + 4-6 patient).
--
-- All inserts happen in a single batch at the END of the session, after the
-- patient closes the reflection screen. We do NOT write per-turn during the
-- session — that would burn a network round-trip during meditation, which
-- breaks the offline-first guarantee in AGENTS.md > Domain Constraints.
--
-- Row-Level Security
--   Every row is scoped to `auth.uid()` via the parent `sessions.user_id`.
--   The check-in tables themselves carry `user_id` as a denormalized FK so
--   the RLS predicate is a single equality check (no join), which keeps
--   both the insert and the select path cheap.
--
-- Privacy floor
--   Patient free-text content (`check_in_turns.content`) is treated as
--   PHI-adjacent (AGENTS.md > Security Considerations). Do NOT add it to
--   any analytics export, error-tracking payload, or third-party sink. The
--   only place this data is allowed to leave Supabase is a patient-
--   initiated local export (PDF/JSON) from the Insights page.
--
-- Cleanup of legacy artifacts is intentionally NOT done here. The
-- `sessions` table from migration 001 keeps its existing shape; the new
-- check-in data hangs off of it via `session_id`.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- check_ins
-- ----------------------------------------------------------------------------
create table if not exists public.check_ins (
  id            uuid primary key default gen_random_uuid(),
  session_id    uuid not null
                  references public.sessions(id)
                  on delete cascade,
  user_id       uuid not null
                  references auth.users(id)
                  on delete cascade,
  -- 1..5; one row per check-in slot in a completed session.
  chunk_number  smallint not null
                  check (chunk_number between 1 and 5),
  -- The Turn 1 craving score the patient sent via the slider.
  craving_score smallint not null
                  check (craving_score between 1 and 10),
  -- The obstacle category the agent inferred from the patient's
  -- Turn 2 / Turn 3 reply, or null if no obstacle was named.
  -- Mirrors the ObstacleCategory union in client/types/session.ts.
  obstacle_category text
                  check (
                    obstacle_category is null
                    or obstacle_category in (
                      'cannot_visualize',
                      'mind_wandering',
                      'urge_overwhelming',
                      'breath_tight',
                      'breath_anxiety',
                      'gave_in',
                      'guilt_failure',
                      'physical_discomfort',
                      'sleepiness'
                    )
                  ),
  -- Affirmative-readiness reply at Turn 5. Null at Check-in 5
  -- because Check-in 5 has no readiness ask (PRD § Check-In
  -- Conversation Protocol > Check-in 5 exception).
  ready_to_continue boolean,
  started_at    timestamptz not null,
  ended_at      timestamptz not null,
  created_at    timestamptz not null default now(),
  unique (session_id, chunk_number)
);

create index if not exists check_ins_session_id_idx
  on public.check_ins (session_id);
create index if not exists check_ins_user_id_idx
  on public.check_ins (user_id);

-- ----------------------------------------------------------------------------
-- check_in_turns
-- ----------------------------------------------------------------------------
create table if not exists public.check_in_turns (
  id           uuid primary key default gen_random_uuid(),
  check_in_id  uuid not null
                  references public.check_ins(id)
                  on delete cascade,
  user_id      uuid not null
                  references auth.users(id)
                  on delete cascade,
  -- 1-based, monotonically increasing within a single check-in.
  turn_index   smallint not null
                  check (turn_index between 1 and 30),
  role         text not null
                  check (role in ('agent', 'patient')),
  -- Plain text. Never markdown, never HTML.
  content      text not null
                  check (char_length(content) between 1 and 2000),
  -- Provenance for eval + LoRA training data audits.
  via          text not null
                  check (via in ('lora', 'fallback', 'patient')),
  -- Agent turn only: ms from the patient's prior message to first
  -- token. Null for patient turns.
  at_latency_ms integer
                  check (at_latency_ms is null or at_latency_ms >= 0),
  -- Agent turn only: marks the explicit readiness ask. Used so the
  -- analytics path can replay the readiness gate without re-running
  -- isAffirmative() heuristics.
  is_readiness_ask boolean not null default false,
  created_at   timestamptz not null default now(),
  unique (check_in_id, turn_index)
);

create index if not exists check_in_turns_check_in_id_idx
  on public.check_in_turns (check_in_id);
create index if not exists check_in_turns_user_id_idx
  on public.check_in_turns (user_id);

-- ----------------------------------------------------------------------------
-- Row-Level Security
--
-- Every read and write is scoped to the authenticated user. We use
-- (select auth.uid()) instead of auth.uid() directly so the planner
-- caches the function call once per query rather than per row
-- (.claude/skills/supabase-postgres-best-practices).
-- ----------------------------------------------------------------------------
alter table public.check_ins enable row level security;
alter table public.check_in_turns enable row level security;

drop policy if exists "check_ins owner select" on public.check_ins;
create policy "check_ins owner select"
  on public.check_ins
  for select
  to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists "check_ins owner insert" on public.check_ins;
create policy "check_ins owner insert"
  on public.check_ins
  for insert
  to authenticated
  with check ((select auth.uid()) = user_id);

drop policy if exists "check_ins owner delete" on public.check_ins;
create policy "check_ins owner delete"
  on public.check_ins
  for delete
  to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists "check_in_turns owner select" on public.check_in_turns;
create policy "check_in_turns owner select"
  on public.check_in_turns
  for select
  to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists "check_in_turns owner insert" on public.check_in_turns;
create policy "check_in_turns owner insert"
  on public.check_in_turns
  for insert
  to authenticated
  with check ((select auth.uid()) = user_id);

drop policy if exists "check_in_turns owner delete" on public.check_in_turns;
create policy "check_in_turns owner delete"
  on public.check_in_turns
  for delete
  to authenticated
  using ((select auth.uid()) = user_id);

-- Intentionally NO update policy on either table. Check-in turns are
-- immutable once written (PRD § Data Model — turn rows are append-only
-- so the eval / LoRA training audit trail stays trustworthy).
