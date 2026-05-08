import type { HevyWorkout, HevyExerciseTemplate } from './types'

const CACHE_KEY = 'health-dashboard-hevy-cache'
const CACHE_VERSION = 1

interface CachePayload {
  version: number
  syncedAt: number
  keyFingerprint: string
  workouts: HevyWorkout[]
  templates: [string, HevyExerciseTemplate][]
}

// Cheap fingerprint — not a security boundary, just a cache-key changer.
function fingerprint(key: string): string {
  let h = 5381
  for (let i = 0; i < key.length; i++) h = ((h << 5) + h + key.charCodeAt(i)) | 0
  return `${key.length}-${(h >>> 0).toString(16)}`
}

export interface HevyCache {
  syncedAt: number
  workouts: HevyWorkout[]
  templates: Map<string, HevyExerciseTemplate>
}

export function loadCache(apiKey: string): HevyCache | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY)
    if (!raw) return null
    const payload = JSON.parse(raw) as CachePayload
    if (payload.version !== CACHE_VERSION) return null
    if (payload.keyFingerprint !== fingerprint(apiKey)) return null
    return {
      syncedAt: payload.syncedAt,
      workouts: payload.workouts,
      templates: new Map(payload.templates),
    }
  } catch {
    return null
  }
}

export function saveCache(apiKey: string, cache: HevyCache): void {
  try {
    const payload: CachePayload = {
      version: CACHE_VERSION,
      syncedAt: cache.syncedAt,
      keyFingerprint: fingerprint(apiKey),
      workouts: cache.workouts,
      templates: [...cache.templates.entries()],
    }
    localStorage.setItem(CACHE_KEY, JSON.stringify(payload))
  } catch (e) {
    console.warn('Hevy cache save failed (likely quota):', e)
  }
}

export function clearCache(): void {
  localStorage.removeItem(CACHE_KEY)
}
