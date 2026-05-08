import type { Workout, HevyWorkout } from './types'

const STRENGTH_LIKE = new Set([
  'FunctionalStrengthTraining',
  'TraditionalStrengthTraining',
  'CoreTraining',
  'Other',
])

function localDay(iso: string): string {
  const d = new Date(iso)
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

function overlapMs(aStart: number, aEnd: number, bStart: number, bEnd: number): number {
  return Math.max(0, Math.min(aEnd, bEnd) - Math.max(aStart, bStart))
}

export interface MatchResult {
  matched: number
  unmatched: HevyWorkout[]
}

export function applyHevyMatches(
  workouts: Workout[],
  hevyWorkouts: HevyWorkout[],
): MatchResult {
  for (const w of workouts) w.hevy = undefined

  const candidates = workouts
    .map((w, i) => ({ w, i, s: +new Date(w.startDate), e: +new Date(w.endDate) }))
    .filter(c => STRENGTH_LIKE.has(c.w.type))

  const used = new Set<number>()
  const unmatched: HevyWorkout[] = []
  let matched = 0

  for (const h of hevyWorkouts) {
    const hs = +new Date(h.startDate)
    const he = +new Date(h.endDate)
    const hDay = localDay(h.startDate)
    let best: { i: number; ratio: number } | null = null

    for (const c of candidates) {
      if (used.has(c.i)) continue
      if (localDay(c.w.startDate) !== hDay) continue
      const ov = overlapMs(hs, he, c.s, c.e)
      const minDur = Math.min(he - hs, c.e - c.s)
      const ratio = minDur > 0 ? ov / minDur : 0
      if (ratio >= 0.5 && (!best || ratio > best.ratio)) best = { i: c.i, ratio }
    }

    if (best) {
      workouts[best.i].hevy = h
      used.add(best.i)
      matched++
    } else {
      unmatched.push(h)
    }
  }

  return { matched, unmatched }
}
