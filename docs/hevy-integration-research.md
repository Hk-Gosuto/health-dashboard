# Hevy Integration — Research

> Goal: import strength-training detail (exercises, sets, reps, weight, RPE, notes) from
> [Hevy](https://www.hevyapp.com/) into the Apple Health Dashboard, and match each Hevy
> session to the existing Apple Health `Workout` so the two data sources merge without
> duplication.

Status: research only — no code changes. All claims here are sourced from the public
Hevy API docs and a handful of OSS clients that wrap it (see "Sources" at the bottom).
Confirm the live OpenAPI spec at <https://api.hevyapp.com/docs/> before implementing,
since the API is still v1 and field names occasionally drift.

---

## 1. Summary / recommendation

- **Use the API key flow, not OAuth.** Hevy's public API is API-key only; there is no
  OAuth provider. The user pastes a key from `https://hevy.com/settings?developer` into
  the dashboard, we store it in `localStorage`, and call the API directly from the
  browser. Same trust model the rest of the app already uses (everything stays
  client-side).
- **Pull `GET /v1/workouts` paginated, then incremental sync via `GET /v1/workouts/events`.**
  Page size caps at 10. Cache the full list in IndexedDB (next to the parsed Apple Health
  data) and only re-pull the events feed on subsequent loads.
- **Match Hevy sessions ↔ Apple Health workouts by time-window overlap on the same day.**
  Apple Health emits a `FunctionalStrengthTraining` / `TraditionalStrengthTraining`
  workout when the Watch records a lift; Hevy records the same lift with
  `start_time`/`end_time`. A simple "≥50 % overlap and same calendar day" rule resolves
  the pairing in practice. Unmatched Hevy sessions are surfaced as their own entries.
- **Add a new `Strength` tab + extend `Workout` with optional `hevy?: HevyWorkout`.**
  Don't fork the existing `TrainingViewer` — augment the data model so other tabs
  (Personal Records, Calendar Heatmap, Year in Review) automatically benefit.
- **Hevy API requires a Pro subscription.** Document this prominently in the UI.

> ⚠️ **Caveat — CORS:** Hevy does not publicly document CORS headers. If
> `api.hevyapp.com` rejects browser requests with no `Access-Control-Allow-Origin`,
> we'll need a thin proxy (Vercel function, Cloudflare worker) — this needs a one-shot
> `curl -i -H 'Origin: https://...'` test as the very first implementation step. See §8.

---

## 2. Hevy API basics

| Item            | Value                                                                                       |
| --------------- | ------------------------------------------------------------------------------------------- |
| Base URL        | `https://api.hevyapp.com/v1`                                                                |
| Auth            | Header `api-key: <key>` on every request                                                    |
| Key issuance    | <https://hevy.com/settings?developer> (Hevy Pro only)                                       |
| Plan gate       | Pro subscription required for both the key and webhooks                                     |
| OAuth available | **No** — single static key per user                                                         |
| OpenAPI         | <https://api.hevyapp.com/docs/> (Swagger UI)                                                |
| Pagination      | `?page=N&pageSize=K`, **`pageSize` max = 10**                                               |
| Rate limits     | Not publicly documented — treat as low; sleep-and-retry on 429                              |
| Units           | Weight returned as `weight_kg` (also `weight_lb` in some clients, computed); distance in m  |

### Why API key (not OAuth)

The user explicitly mentioned both options. Hevy only ships the API-key option today,
so the choice is forced. That's fine for this app:

- The dashboard already runs entirely client-side and asks the user for their Apple
  Health export — adding "paste your Hevy key" is the same trust contract.
- No backend means nothing to host. We never see the key.
- Storage: `localStorage['hevy_api_key']`. Wipe on a "Disconnect Hevy" button.
- The key has full read+write scope on the user's account (the API can also create
  workouts), so we should be careful to only call read endpoints. The `simplify` skill
  rule applies: don't add write helpers we don't need.

---

## 3. Endpoints we'll use

All paths are under `https://api.hevyapp.com/v1`.

| Method | Path                              | Purpose                                                             | Used by us?  |
| ------ | --------------------------------- | ------------------------------------------------------------------- | ------------ |
| GET    | `/workouts?page=&pageSize=`       | List workouts, newest-first. **`pageSize` max 10**.                 | ✅ initial sync |
| GET    | `/workouts/count`                 | Total workout count — used to know when to stop paginating          | ✅ initial sync |
| GET    | `/workouts/{id}`                  | Single workout (same shape as list item)                            | ✅ on demand   |
| GET    | `/workouts/events?since=ISO&page=&pageSize=` | Paged list of `updated`/`deleted` events newest-first    | ✅ incremental sync |
| GET    | `/exercise_templates`             | Exercise catalog (id → name, muscle group, equipment)               | ✅ resolve names, cache aggressively |
| GET    | `/exercise_templates/{id}`        | Single template                                                     | optional     |
| GET    | `/routines`                       | User's saved routines/programs                                      | ❌ not needed for import |
| GET    | `/routine_folders`                | Routine folder grouping                                             | ❌            |
| POST   | `/webhook-subscription`           | Register a webhook for `workout.updated` / `workout.deleted`        | ❌ (no server) |
| POST   | `/workouts`                       | Create a workout                                                    | ❌ never       |
| PUT    | `/workouts/{id}`                  | Update a workout                                                    | ❌ never       |

### Sync algorithm

```ts
// Pseudocode, fits cleanly next to App.tsx's existing IndexedDB cache.
async function syncHevy(apiKey: string, prev: HevySyncState | null): Promise<HevySyncState> {
  const headers = { 'api-key': apiKey }
  const base = 'https://api.hevyapp.com/v1'

  if (!prev) {
    // First-time pull: paginate /workouts until we have all of them.
    const { workout_count } = await fetch(`${base}/workouts/count`, { headers }).then(r => r.json())
    const pages = Math.ceil(workout_count / 10)
    const all: HevyWorkout[] = []
    for (let p = 1; p <= pages; p++) {
      const r = await fetch(`${base}/workouts?page=${p}&pageSize=10`, { headers })
      if (r.status === 429) { await sleep(2000); p--; continue }
      const { workouts } = await r.json()
      all.push(...workouts)
    }
    return { workouts: all, lastSyncIso: new Date().toISOString() }
  }

  // Incremental: only fetch events since lastSyncIso.
  const events = await pageAll(`${base}/workouts/events?since=${prev.lastSyncIso}`, headers)
  const byId = new Map(prev.workouts.map(w => [w.id, w]))
  for (const ev of events) {
    if (ev.type === 'deleted') byId.delete(ev.id)
    else if (ev.type === 'updated') byId.set(ev.id, ev.workout)
  }
  return { workouts: [...byId.values()], lastSyncIso: new Date().toISOString() }
}
```

The `events` feed is the entire reason we don't have to re-fetch the whole history every
load — it's exactly what we want for a static-hosted app with no background workers.

---

## 4. Workout response schema

Composite from the public Swagger spec and the `gregwilson777/go-hevy` Go client (its
struct names map 1-to-1 to the JSON keys, snake-cased). Fields marked **(verify)** were
inferred from one source only.

```jsonc
// GET /v1/workouts response
{
  "page": 1,
  "page_count": 42,
  "workouts": [
    {
      "id": "b459cba5-cd6d-463c-abd6-54f8eafcadcb",
      "title": "Push Day",
      "description": "felt strong, +2.5kg on bench",
      "start_time": "2026-04-30T17:12:08Z",
      "end_time":   "2026-04-30T18:34:51Z",
      "created_at": "2026-04-30T18:35:00Z",
      "updated_at": "2026-04-30T18:35:00Z",
      "is_private": false,                  // (verify)
      "exercises": [
        {
          "index": 0,
          "title": "Bench Press (Barbell)",
          "notes": "",
          "exercise_template_id": "79D0BB3A",   // join key against /exercise_templates
          "superset_id": null,                  // int or null
          "sets": [
            {
              "index": 0,
              "type": "warmup",          // "normal" | "warmup" | "dropset" | "failure"
              "weight_kg": 40,
              "reps": 10,
              "distance_meters": null,    // populated for cardio-template exercises
              "duration_seconds": null,   // populated for plank/timed exercises
              "rpe": null,                // 1–10, nullable
              "custom_metric": null       // (verify) free-form numeric field
            },
            { "index": 1, "type": "normal",  "weight_kg": 80, "reps": 8, "rpe": 8 },
            { "index": 2, "type": "normal",  "weight_kg": 80, "reps": 7, "rpe": 9 },
            { "index": 3, "type": "failure", "weight_kg": 80, "reps": 5, "rpe": 10 }
          ]
        }
      ]
    }
  ]
}
```

### `GET /v1/workouts/events` response

```jsonc
{
  "page": 1,
  "page_count": 1,
  "events": [
    { "type": "updated", "workout": { /* full Workout object as above */ } },
    { "type": "deleted", "id": "b459cba5-cd6d-463c-abd6-54f8eafcadcb", "deleted_at": "2026-05-03T11:00:00Z" }
  ]
}
```

### `GET /v1/exercise_templates` response

```jsonc
{
  "page": 1,
  "page_count": 12,
  "exercise_templates": [
    {
      "id": "79D0BB3A",
      "title": "Bench Press (Barbell)",
      "type": "weight_reps",                  // weight_reps | reps_only | duration | distance_duration | weight_duration
      "primary_muscle_group": "chest",
      "secondary_muscle_groups": ["triceps", "shoulders"],
      "equipment": "barbell",
      "is_custom": false
    }
  ]
}
```

The catalog is small and stable — fetch once, cache in IndexedDB indefinitely, refresh
weekly. Hevy's MCP server explicitly does this for the same reason.

---

## 5. Mapping to our existing types

We add **one new type** and a **single optional field** on `Workout`. This is the minimal
change that lets every existing tab (Personal Records, Calendar Heatmap, Year in Review,
Correlations) start surfacing strength data with no special-casing.

```ts
// src/types.ts — additions

export interface HevySet {
  index: number
  type: 'normal' | 'warmup' | 'dropset' | 'failure'
  weightKg: number | null
  reps: number | null
  distanceM: number | null
  durationSec: number | null
  rpe: number | null
}

export interface HevyExercise {
  index: number
  title: string                    // resolved via exercise_templates
  templateId: string
  primaryMuscleGroup: string | null
  notes: string
  supersetId: number | null
  sets: HevySet[]
  volumeKg: number                 // computed: Σ weightKg * reps for normal+failure sets
}

export interface HevyWorkout {
  id: string
  title: string
  description: string
  startDate: string                // ISO, == start_time
  endDate: string                  // ISO, == end_time
  exercises: HevyExercise[]
  totalVolumeKg: number            // Σ exercises.volumeKg
  totalSets: number
  totalReps: number
}

export interface Workout {
  // ...existing fields unchanged...
  hevy?: HevyWorkout               // <— populated when matched
}

export interface HealthData {
  // ...existing fields unchanged...
  hevyWorkouts?: HevyWorkout[]     // unmatched Hevy sessions live here
  hevySyncState?: { lastSyncIso: string; apiKeyHash: string }
}
```

Why optional `hevy?: HevyWorkout` on `Workout` instead of a separate top-level array:

- Existing tabs already iterate `healthData.workouts`. They need zero changes; new tabs
  that want detail can check `if (w.hevy) { ... }`.
- Personal Records can start computing 1RM/e1RM when `w.hevy` is present.
- The Calendar Heatmap can start coloring strength days differently with a one-line check.
- Unmatched Hevy sessions (rare — usually means the user forgot to wear the Watch) get
  their own list so they aren't lost.

---

## 6. Matching strategy: Hevy ↔ Apple Health workouts

The whole point of this integration is **complement, don't duplicate**.

### What Apple Health emits for a lift

When the Apple Watch records a strength session, parseWorker.ts produces a `Workout`
with one of these `type`s (`HKWorkoutActivityType` prefix already stripped):

- `FunctionalStrengthTraining` — most common for free weights / mixed sessions
- `TraditionalStrengthTraining` — barbell-style sessions
- `CoreTraining`
- `Other` — fallback

These carry HR avg/min/max, calories, duration, but **no exercise/set/rep data**. That's
exactly the gap Hevy fills.

### Matching rule

For each `HevyWorkout h`, find the Apple Health `Workout aw` such that:

1. `aw.type ∈ STRENGTH_LIKE_TYPES` (the four above), AND
2. `aw.startDate.slice(0,10) === h.startDate.slice(0,10)` (same calendar day in local TZ), AND
3. **time overlap ≥ 50 %** of the shorter session — i.e.
   `overlap(aw, h) / min(durationOf(aw), durationOf(h)) ≥ 0.5`.

If multiple Apple workouts qualify, pick the one with the highest overlap ratio.
Ties broken by closest start time.

```ts
// src/hevyMatch.ts — proposed new file
const STRENGTH_LIKE = new Set([
  'FunctionalStrengthTraining',
  'TraditionalStrengthTraining',
  'CoreTraining',
  'Other',
])

function overlapMin(aStart: number, aEnd: number, bStart: number, bEnd: number) {
  return Math.max(0, Math.min(aEnd, bEnd) - Math.max(aStart, bStart)) / 60000
}

export function matchHevyToApple(apple: Workout[], hevy: HevyWorkout[]) {
  const matched = new Map<string, Workout>()              // hevy.id → apple workout
  const used = new Set<Workout>()
  const sortedApple = apple
    .filter(w => STRENGTH_LIKE.has(w.type))
    .map(w => ({ w, s: +new Date(w.startDate), e: +new Date(w.endDate) }))

  for (const h of hevy) {
    const hs = +new Date(h.startDate), he = +new Date(h.endDate)
    let best: { w: Workout; ratio: number } | null = null
    for (const cand of sortedApple) {
      if (used.has(cand.w)) continue
      if (cand.w.date !== h.startDate.slice(0, 10)) continue
      const ov = overlapMin(hs, he, cand.s, cand.e)
      const minDur = Math.min((he - hs) / 60000, (cand.e - cand.s) / 60000)
      const ratio = minDur > 0 ? ov / minDur : 0
      if (ratio >= 0.5 && (!best || ratio > best.ratio)) best = { w: cand.w, ratio }
    }
    if (best) { matched.set(h.id, best.w); used.add(best.w) }
  }

  return matched
}
```

After matching, we mutate the `Workout[]` in place: `aw.hevy = h`. Hevy sessions with no
match go into `healthData.hevyWorkouts`.

### Why the 50 % overlap threshold?

In practice the two recordings of the same session disagree by a few minutes:

- The Watch auto-pauses; Hevy doesn't.
- Hevy includes the warmup setup time before you press start on the Watch.
- Cooldown stretching often gets logged on one side only.

Even so, the bulk of the session always overlaps. A 50 % threshold is loose enough to
catch the pairing without ever colliding two unrelated sessions on the same day (most
people don't lift twice within a few hours). Alternative thresholds and edge cases are
worth playing with on real data.

### Edge cases worth handling

| Case                                        | Behavior                                                 |
| ------------------------------------------- | -------------------------------------------------------- |
| Lift logged in Hevy, no Watch worn          | Goes into `hevyWorkouts`, surfaced as standalone in UI   |
| Watch lift, no Hevy entry                   | Existing behavior — `Workout` with no `.hevy`            |
| Two strength workouts same day, both logged | Both match independently (greedy, used-set prevents dup) |
| Hevy session crossing midnight              | Pair on the **start_time** day, like Apple Health does   |
| Time-zone skew                              | Compare on local-day strings to avoid DST/UTC bugs       |
| User edits a Hevy workout (`updated` event) | Re-run matcher on next load                              |

---

## 7. UI integration plan

Three small surface changes, in priority order:

1. **Settings → Connections** card on the upload screen (`App.tsx`):
   "Connect Hevy" → text input for API key → "Sync now" → progress bar → success count.
   Reuses the existing `ProgressBar` component. Persist key + cached workouts in
   IndexedDB next to the Apple Health cache.

2. **`Strength` tab** (new file `src/Strength.tsx`, lazy-loaded like the others):
   - List of recent sessions, each expandable to exercise → sets table.
   - Volume-by-muscle-group stacked area, weekly granularity.
   - Top-N e1RM trend per exercise (Epley: `weight * (1 + reps/30)`).
   - "Linked to Apple Health workout?" badge per session.

3. **Existing tabs that get free wins from `Workout.hevy`:**
   - `PersonalRecords.tsx` — heaviest set, best e1RM per template.
   - `CalendarHeatmap.tsx` — colour strength days when `w.hevy` is present.
   - `Correlations.tsx` — strength-volume vs. HRV / sleep / RHR correlation.
   - `YearInReview.tsx` — total tonnage moved.

UI work is deliberately small. The schema (§5) and matcher (§6) are the load-bearing
parts.

---

## 8. Open questions / risks

- **CORS.** Top-priority unknown. Quick test before any implementation effort:
  ```bash
  curl -i -H "api-key: $HEVY_KEY" -H "Origin: https://localhost:5173" \
       https://api.hevyapp.com/v1/workouts/count
  ```
  If `Access-Control-Allow-Origin` is missing or restrictive, the only options are:
  (a) ship a 20-line Vercel/Netlify function as a proxy (breaks our "no server" pitch
  but the user already deploys to Vercel — see `App.tsx` cache code), or
  (b) ask the user to paste a JSON export instead of using the live API. Hevy doesn't
  ship a manual JSON export today, so (a) is the realistic fallback.
- **Rate limits.** Not documented. Assume conservative (~5 req/s) and respect 429
  with exponential backoff.
- **Unit handling.** Hevy stores everything in kg internally even when the user's app is
  set to lb. Fine for us — we're metric throughout.
- **Custom exercises.** Users can create custom templates; their `id`s are still
  resolvable via `/exercise_templates`. No special handling needed beyond caching the
  catalog.
- **Routines vs. workouts.** Routines are *plans*, not *records*. We ignore them for
  this integration; the user already has the executed-workout truth.
- **Pro requirement.** Communicate clearly. If the user isn't on Hevy Pro the API
  returns 401/403 even with a valid-looking key.
- **API drift.** Hevy's API is v1 but young. Lock the OpenAPI spec hash in
  `package.json` or generate types from it (`openapi-typescript`) so silent rename
  bugs are caught at build time.

---

## 9. Implementation checklist (when we decide to build)

- [ ] `curl` test for CORS — decide: direct browser calls vs. tiny proxy.
- [ ] Add `HevySet`, `HevyExercise`, `HevyWorkout` to `src/types.ts`; extend `Workout`
      with optional `hevy?` and `HealthData` with `hevyWorkouts?` + `hevySyncState?`.
- [ ] `src/hevyClient.ts` — `listAllWorkouts`, `pollEvents`, `getExerciseTemplates`,
      with kg/snake_case → camelCase normalization and computed `volumeKg`/`totalSets`.
- [ ] `src/hevyMatch.ts` — `matchHevyToApple()` per §6.
- [ ] `App.tsx` — IndexedDB store `hevy-cache` (workouts, lastSyncIso, templateCatalog).
- [ ] Upload-screen "Connect Hevy" card; "Disconnect" wipes key and cache.
- [ ] `src/Strength.tsx` tab + lazy-load entry in `Dashboard.tsx`.
- [ ] Augment `PersonalRecords.tsx` and `CalendarHeatmap.tsx` to read `w.hevy`.
- [ ] Tests on real export data: at least one matched, one unmatched, one same-day-double
      session.

---

## Sources

- [Hevy Public API — Swagger UI](https://api.hevyapp.com/docs/) — official spec
- [Hevy Developer Settings](https://hevy.com/settings?developer) — API key issuance
- [chrisdoc/hevy-mcp on GitHub](https://github.com/chrisdoc/hevy-mcp) — MCP server with
  full tool surface; mirrors API endpoints
- [gregwilson777/go-hevy on pkg.go.dev](https://pkg.go.dev/github.com/gregwilson777/go-hevy)
  — Go client; cleanest source for the `Workout`/`Exercise`/`Set` field names and types
- [remuzel/hevy-api on GitHub](https://github.com/remuzel/hevy-api) — Python client
- [hevy-cli on PyPI](https://pypi.org/project/hevy-cli/) — CLI client, useful for local
  smoke testing
- [Sync Hevy Workouts to Notion using Zapier — james-carr.org](https://james-carr.org/posts/sync-hevy-to-notion-using-zapier/)
  — example webhook payload
- [Sync Hevy to Notion with Azure Functions — denishartl.com](https://www.denishartl.com/how-to-automate-hevy-workout-tracking-with-notion-and-azure-functions/)
  — example webhook integration architecture
