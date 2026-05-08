import type { HevyWorkout, HevyExercise, HevySet, HevyExerciseTemplate } from './types'

const BASE = 'https://api.hevyapp.com/v1'
const PAGE_SIZE = 10

interface RawSet {
  index: number
  type: string
  weight_kg: number | null
  reps: number | null
  distance_meters: number | null
  duration_seconds: number | null
  rpe: number | null
}

interface RawExercise {
  index: number
  title: string
  notes: string
  exercise_template_id: string
  superset_id: number | null
  sets: RawSet[]
}

interface RawWorkout {
  id: string
  title: string
  description: string
  start_time: string
  end_time: string
  exercises: RawExercise[]
}

function normalizeSet(s: RawSet): HevySet {
  return {
    index: s.index,
    type: s.type,
    weightKg: s.weight_kg,
    reps: s.reps,
    distanceM: s.distance_meters,
    durationSec: s.duration_seconds,
    rpe: s.rpe,
  }
}

function normalizeExercise(e: RawExercise): HevyExercise {
  const sets = e.sets.map(normalizeSet)
  const volumeKg = sets.reduce((sum, st) => {
    if (st.type === 'warmup' || st.type === 'dropset') return sum
    return sum + (st.weightKg ?? 0) * (st.reps ?? 0)
  }, 0)
  return {
    index: e.index,
    title: e.title,
    templateId: e.exercise_template_id,
    notes: e.notes,
    supersetId: e.superset_id,
    sets,
    volumeKg,
  }
}

function normalizeWorkout(w: RawWorkout): HevyWorkout {
  const exercises = w.exercises.map(normalizeExercise)
  const totalVolumeKg = exercises.reduce((s, ex) => s + ex.volumeKg, 0)
  const totalSets = exercises.reduce((s, ex) => s + ex.sets.length, 0)
  const totalReps = exercises.reduce(
    (s, ex) => s + ex.sets.reduce((rs, st) => rs + (st.reps ?? 0), 0),
    0,
  )
  const startMs = +new Date(w.start_time)
  const endMs = +new Date(w.end_time)
  return {
    id: w.id,
    title: w.title,
    description: w.description,
    startDate: w.start_time,
    endDate: w.end_time,
    exercises,
    totalVolumeKg,
    totalSets,
    totalReps,
    durationMin: Math.max(0, (endMs - startMs) / 60000),
  }
}

async function authedFetch(path: string, apiKey: string): Promise<Response> {
  for (let attempt = 0; attempt < 4; attempt++) {
    const res = await fetch(`${BASE}${path}`, { headers: { 'api-key': apiKey } })
    if (res.status !== 429) return res
    await new Promise(r => setTimeout(r, 1500 * (attempt + 1)))
  }
  throw new Error('Hevy API rate-limit retries exhausted')
}

export async function getWorkoutCount(apiKey: string): Promise<number> {
  const res = await authedFetch('/workouts/count', apiKey)
  if (!res.ok) throw new Error(await describeError(res))
  const body = await res.json() as { workout_count: number }
  return body.workout_count
}

export interface SyncProgress {
  fetched: number
  total: number
}

export async function listAllWorkouts(
  apiKey: string,
  onProgress?: (p: SyncProgress) => void,
): Promise<HevyWorkout[]> {
  const total = await getWorkoutCount(apiKey)
  if (total === 0) return []

  const pages = Math.ceil(total / PAGE_SIZE)
  const all: HevyWorkout[] = []
  for (let p = 1; p <= pages; p++) {
    const res = await authedFetch(`/workouts?page=${p}&pageSize=${PAGE_SIZE}`, apiKey)
    if (!res.ok) throw new Error(await describeError(res))
    const body = await res.json() as { workouts: RawWorkout[] }
    for (const w of body.workouts) all.push(normalizeWorkout(w))
    onProgress?.({ fetched: all.length, total })
  }
  return all
}

interface RawTemplate {
  id: string
  title: string
  type: string
  primary_muscle_group: string | null
  secondary_muscle_groups: string[] | null
  equipment: string | null
  is_custom: boolean
}

export async function getExerciseTemplates(apiKey: string): Promise<Map<string, HevyExerciseTemplate>> {
  const out = new Map<string, HevyExerciseTemplate>()
  let page = 1
  let pageCount = 1
  while (page <= pageCount) {
    const res = await authedFetch(`/exercise_templates?page=${page}&pageSize=100`, apiKey)
    if (!res.ok) throw new Error(await describeError(res))
    const body = await res.json() as { page: number; page_count: number; exercise_templates: RawTemplate[] }
    pageCount = body.page_count
    for (const t of body.exercise_templates) {
      out.set(t.id, {
        id: t.id,
        title: t.title,
        type: t.type,
        primaryMuscleGroup: t.primary_muscle_group,
        secondaryMuscleGroups: t.secondary_muscle_groups ?? [],
        equipment: t.equipment,
        isCustom: t.is_custom,
      })
    }
    page++
  }
  return out
}

async function describeError(res: Response): Promise<string> {
  let detail = ''
  try { detail = await res.text() } catch { /* ignore */ }
  if (res.status === 401 || res.status === 403) {
    return `Hevy API rejected the key (HTTP ${res.status}). The Hevy API requires a Pro subscription.`
  }
  return `Hevy API error ${res.status}: ${detail.slice(0, 200)}`
}
