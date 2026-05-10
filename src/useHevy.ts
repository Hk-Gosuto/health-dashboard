import { useState, useEffect, useCallback } from 'react'
import type { Workout, HevyWorkout, HevyExerciseTemplate } from './types'
import { listAllWorkouts, getExerciseTemplates, type SyncProgress } from './hevyClient'
import { applyHevyMatches } from './hevyMatch'
import { loadCache, saveCache, clearCache } from './hevyCache'

const ENV_HEVY_KEY = (import.meta.env.VITE_HEVY_API_KEY as string | undefined)?.trim() || ''

export interface UseHevyResult {
  hasKey: boolean
  hevy: HevyWorkout[] | null
  templates: Map<string, HevyExerciseTemplate> | null
  syncing: boolean
  progress: SyncProgress | null
  syncedAt: number | null
  error: string | null
  sync: () => Promise<void>
  disconnect: () => void
}

export function useHevy(workouts: Workout[]): UseHevyResult {
  const [syncing, setSyncing] = useState(false)
  const [progress, setProgress] = useState<SyncProgress | null>(null)
  const [hevy, setHevy] = useState<HevyWorkout[] | null>(null)
  const [templates, setTemplates] = useState<Map<string, HevyExerciseTemplate> | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [syncedAt, setSyncedAt] = useState<number | null>(null)

  const applyData = useCallback((all: HevyWorkout[], tmpl: Map<string, HevyExerciseTemplate>) => {
    for (const w of all) {
      for (const ex of w.exercises) {
        ex.primaryMuscleGroup = tmpl.get(ex.templateId)?.primaryMuscleGroup ?? null
      }
    }
    applyHevyMatches(workouts, all)
    setTemplates(tmpl)
    setHevy(all)
  }, [workouts])

  const sync = useCallback(async () => {
    if (!ENV_HEVY_KEY) return
    setSyncing(true)
    setError(null)
    setProgress(null)
    try {
      const [all, tmpl] = await Promise.all([
        listAllWorkouts(ENV_HEVY_KEY, p => setProgress(p)),
        getExerciseTemplates(ENV_HEVY_KEY),
      ])
      applyData(all, tmpl)
      const now = Date.now()
      setSyncedAt(now)
      saveCache(ENV_HEVY_KEY, { syncedAt: now, workouts: all, templates: tmpl })
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setSyncing(false)
    }
  }, [applyData])

  const disconnect = useCallback(() => {
    for (const w of workouts) w.hevy = undefined
    clearCache()
    setHevy(null)
    setTemplates(null)
    setSyncedAt(null)
    setError(null)
  }, [workouts])

  useEffect(() => {
    if (!ENV_HEVY_KEY || hevy) return
    const cached = loadCache(ENV_HEVY_KEY)
    if (cached) {
      applyData(cached.workouts, cached.templates)
      setSyncedAt(cached.syncedAt)
      return
    }
    sync()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return {
    hasKey: Boolean(ENV_HEVY_KEY),
    hevy,
    templates,
    syncing,
    progress,
    syncedAt,
    error,
    sync,
    disconnect,
  }
}
