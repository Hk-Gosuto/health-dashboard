import { useMemo, useState, useCallback, useEffect } from 'react'
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid, ResponsiveContainer,
  LineChart, Line, ScatterChart, Scatter, ComposedChart, ReferenceDot, ReferenceLine,
} from 'recharts'
import { ChevronDown, ChevronRight, Watch, Link2Off, Loader2, Plug, Unplug, RefreshCw } from 'lucide-react'
import type { HealthData, Workout, HevyWorkout, HevyExercise, HevyExerciseTemplate } from './types'
import { listAllWorkouts, getExerciseTemplates, type SyncProgress } from './hevyClient'
import { applyHevyMatches } from './hevyMatch'
import { loadCache, saveCache, clearCache } from './hevyCache'

const ENV_HEVY_KEY = (import.meta.env.VITE_HEVY_API_KEY as string | undefined)?.trim() || ''

function timeAgo(ms: number): string {
  const s = Math.floor((Date.now() - ms) / 1000)
  if (s < 60) return 'just now'
  if (s < 3600) return `${Math.floor(s / 60)}m ago`
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`
  return `${Math.floor(s / 86400)}d ago`
}
import { COLORS, chartMargin, ChartTooltip, SectionHeader, TabHeader, useChartTheme, fmt, shortDateCompact } from './ui'

// ─── helpers ────────────────────────────────────────────────────────────────

function startOfIsoWeek(iso: string): string {
  const d = new Date(iso)
  const day = (d.getDay() + 6) % 7
  d.setDate(d.getDate() - day)
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${dd}`
}

function localDay(iso: string): string {
  // Returns YYYY-MM-DD in local time
  const d = new Date(iso)
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${dd}`
}

function bestE1RMForExercise(ex: HevyExercise): number {
  let best = 0
  for (const s of ex.sets) {
    if (s.type === 'warmup') continue
    if (s.weightKg == null || s.reps == null || s.reps < 1) continue
    const e = s.weightKg * (1 + s.reps / 30)
    if (e > best) best = e
  }
  return best
}

function pearsonR(xs: number[], ys: number[]): number {
  const n = xs.length
  if (n < 2) return 0
  const mx = xs.reduce((a, b) => a + b, 0) / n
  const my = ys.reduce((a, b) => a + b, 0) / n
  let num = 0, dx2 = 0, dy2 = 0
  for (let i = 0; i < n; i++) {
    const dx = xs[i] - mx
    const dy = ys[i] - my
    num += dx * dy
    dx2 += dx * dx
    dy2 += dy * dy
  }
  return dx2 === 0 || dy2 === 0 ? 0 : num / Math.sqrt(dx2 * dy2)
}

function ageFromDob(dob: string): number {
  if (!dob) return 30
  const birth = new Date(dob)
  const now = new Date()
  let age = now.getFullYear() - birth.getFullYear()
  const m = now.getMonth() - birth.getMonth()
  if (m < 0 || (m === 0 && now.getDate() < birth.getDate())) age--
  return age
}

function bestE1RM(sets: { weightKg: number | null; reps: number | null; type: string }[]): number {
  let best = 0
  for (const s of sets) {
    if (s.type === 'warmup') continue
    if (s.weightKg == null || s.reps == null || s.reps < 1) continue
    const e = s.weightKg * (1 + s.reps / 30)
    if (e > best) best = e
  }
  return best
}

function bestSet(sets: { weightKg: number | null; reps: number | null; type: string }[]): { weight: number; reps: number } | null {
  let best: { weight: number; reps: number } | null = null
  for (const s of sets) {
    if (s.type === 'warmup') continue
    if (s.weightKg == null || s.reps == null) continue
    if (!best || s.weightKg > best.weight) best = { weight: s.weightKg, reps: s.reps }
  }
  return best
}

// Muscle group color map
const MUSCLE_COLORS: Record<string, string> = {
  chest: COLORS.red,
  back: COLORS.blue,
  legs: COLORS.green,
  shoulders: COLORS.purple,
  biceps: COLORS.orange,
  triceps: COLORS.cyan,
  core: COLORS.yellow,
  other: COLORS.zinc,
}

function muscleColor(group: string | null | undefined): string {
  if (!group) return MUSCLE_COLORS.other
  const key = group.toLowerCase()
  for (const [k, v] of Object.entries(MUSCLE_COLORS)) {
    if (key.includes(k)) return v
  }
  return MUSCLE_COLORS.other
}

// ─── types ──────────────────────────────────────────────────────────────────

interface StrengthEntry {
  hevy: HevyWorkout
  apple: Workout | null
}

// ─── main component ──────────────────────────────────────────────────────────

export default function Strength({ data }: { data: HealthData }) {
  const workouts = data.workouts
  const ct = useChartTheme()
  const [apiKey, setApiKey] = useState(ENV_HEVY_KEY)
  const [syncing, setSyncing] = useState(false)
  const [progress, setProgress] = useState<SyncProgress | null>(null)
  const [hevy, setHevy] = useState<HevyWorkout[] | null>(null)
  const [_templates, setTemplates] = useState<Map<string, HevyExerciseTemplate> | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [selectedExercise, setSelectedExercise] = useState<string | null>(null)
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
    const key = apiKey.trim()
    if (!key) return
    setSyncing(true)
    setError(null)
    setProgress(null)
    try {
      const [all, tmpl] = await Promise.all([
        listAllWorkouts(key, p => setProgress(p)),
        getExerciseTemplates(key),
      ])
      applyData(all, tmpl)
      const now = Date.now()
      setSyncedAt(now)
      saveCache(key, { syncedAt: now, workouts: all, templates: tmpl })
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setSyncing(false)
    }
  }, [apiKey, applyData])

  const disconnect = useCallback(() => {
    for (const w of workouts) w.hevy = undefined
    clearCache()
    setHevy(null)
    setTemplates(null)
    setApiKey(ENV_HEVY_KEY)
    setSyncedAt(null)
    setError(null)
  }, [workouts])

  // Hydrate from cache on mount; auto-sync only if env key present and no cache hit.
  useEffect(() => {
    const key = (apiKey || ENV_HEVY_KEY).trim()
    if (!key || hevy) return
    const cached = loadCache(key)
    if (cached) {
      applyData(cached.workouts, cached.templates)
      setSyncedAt(cached.syncedAt)
      return
    }
    if (ENV_HEVY_KEY) sync()
    // We intentionally only run this once per mount with the initial key.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const entries = useMemo<StrengthEntry[]>(() => {
    if (!hevy) return []
    const matched = new Map<string, Workout>()
    for (const w of workouts) {
      if (w.hevy) matched.set(w.hevy.id, w)
    }
    return hevy
      .map(h => ({ hevy: h, apple: matched.get(h.id) ?? null }))
      .sort((a, b) => +new Date(b.hevy.startDate) - +new Date(a.hevy.startDate))
  }, [hevy, workouts])

  // unmatched Hevy workouts stored on data.hevyWorkouts
  const unmatchedHevy: HevyWorkout[] = useMemo(() => data.hevyWorkouts ?? [], [data.hevyWorkouts])

  const stats = useMemo(() => {
    const totalVolume = entries.reduce((s, e) => s + e.hevy.totalVolumeKg, 0)
    const totalSets = entries.reduce((s, e) => s + e.hevy.totalSets, 0)
    const totalReps = entries.reduce((s, e) => s + e.hevy.totalReps, 0)
    const matchedCount = entries.filter(e => e.apple).length
    const totalDurMin = entries.reduce((s, e) => s + e.hevy.durationMin, 0)
    return {
      sessions: entries.length,
      totalVolume,
      totalSets,
      totalReps,
      matchedCount,
      avgDurationMin: entries.length ? totalDurMin / entries.length : 0,
    }
  }, [entries])

  const weeklyVolume = useMemo(() => {
    const map = new Map<string, number>()
    for (const e of entries) {
      const wk = startOfIsoWeek(e.hevy.startDate)
      map.set(wk, (map.get(wk) ?? 0) + e.hevy.totalVolumeKg)
    }
    return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([week, volume]) => ({ week, volume: Math.round(volume) }))
  }, [entries])

  const topExercises = useMemo(() => {
    const map = new Map<string, number>()
    for (const e of entries) {
      for (const ex of e.hevy.exercises) {
        map.set(ex.title, (map.get(ex.title) ?? 0) + ex.volumeKg)
      }
    }
    return [...map.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([title, volume]) => ({ title, volume: Math.round(volume) }))
  }, [entries])

  // Per-exercise history sorted ASC by session start. Used for PR detection + Δ-vs-last.
  const exerciseHistory = useMemo(() => {
    const map = new Map<string, { sessionId: string; sessionStart: string; e1rm: number; volume: number }[]>()
    for (let i = entries.length - 1; i >= 0; i--) {
      const e = entries[i]
      for (const ex of e.hevy.exercises) {
        const arr = map.get(ex.title) ?? []
        arr.push({ sessionId: e.hevy.id, sessionStart: e.hevy.startDate, e1rm: bestE1RMForExercise(ex), volume: ex.volumeKg })
        map.set(ex.title, arr)
      }
    }
    return map
  }, [entries])

  const maxHR = useMemo(() => 220 - ageFromDob(data.profile.dob), [data.profile.dob])

  // Sorted exercise list for dropdown (by total volume desc)
  const exerciseList = useMemo(() => {
    const map = new Map<string, number>()
    const allExercises = entries.flatMap(e => e.hevy.exercises)
      .concat(unmatchedHevy.flatMap(h => h.exercises))
    for (const ex of allExercises) {
      map.set(ex.title, (map.get(ex.title) ?? 0) + ex.volumeKg)
    }
    return [...map.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([title]) => title)
  }, [entries, unmatchedHevy])

  // Default selectedExercise to the top exercise when list loads
  useEffect(() => {
    if (exerciseList.length > 0 && selectedExercise === null) {
      setSelectedExercise(exerciseList[0])
    }
  }, [exerciseList, selectedExercise])

  function toggle(id: string) {
    setExpanded(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }

  if (!hevy) {
    return (
      <>
        <TabHeader
          title="Strength"
          description="Import strength-training detail (exercises, sets, reps, RPE) from Hevy and link it to your Apple Health workouts."
        />
        <div className="bg-zinc-900 rounded-xl p-6 max-w-xl">
          <div className="flex items-start gap-3 mb-4">
            <div className="text-zinc-500 mt-0.5"><Plug size={18} /></div>
            <div>
              <h3 className="text-sm font-medium text-zinc-100">Connect Hevy</h3>
              <p className="text-xs text-zinc-500 mt-1 leading-relaxed">
                Paste your API key from <a href="https://hevy.com/settings?developer" target="_blank" rel="noreferrer" className="text-green-400 hover:underline">hevy.com/settings?developer</a>. Requires Hevy Pro. Workouts are cached locally so subsequent loads don't re-hit the API. You can also set <code className="text-zinc-400 bg-zinc-950 px-1 rounded">VITE_HEVY_API_KEY</code> in <code className="text-zinc-400 bg-zinc-950 px-1 rounded">.env</code> to auto-connect.
              </p>
            </div>
          </div>
          <div className="space-y-3">
            <input
              type="password"
              autoComplete="off"
              spellCheck={false}
              value={apiKey}
              onChange={e => setApiKey(e.target.value)}
              placeholder="api key"
              className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-600 focus:outline-none focus:border-zinc-700 font-mono"
              disabled={syncing}
            />
            <button
              onClick={sync}
              disabled={!apiKey.trim() || syncing}
              className="w-full inline-flex items-center justify-center gap-2 bg-green-500/15 text-green-400 ring-1 ring-green-500/25 hover:bg-green-500/25 rounded-lg px-3 py-2 text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {syncing ? <><Loader2 size={14} className="animate-spin" /> Syncing{progress ? ` ${progress.fetched}/${progress.total}` : '...'}</> : <>Sync workouts</>}
            </button>
            {error && <div className="text-xs text-red-400 bg-red-500/10 ring-1 ring-red-500/25 rounded-lg px-3 py-2">{error}</div>}
          </div>
        </div>
      </>
    )
  }

  if (entries.length === 0) {
    return (
      <>
        <TabHeader title="Strength" description="No Hevy workouts found in your account." />
        <button onClick={disconnect} className="text-xs text-zinc-500 hover:text-zinc-300">Disconnect</button>
      </>
    )
  }

  return (
    <>
      <div className="flex items-start justify-between gap-4 mb-6">
        <div>
          <h1 className="text-[22px] font-semibold text-zinc-100 tracking-tight">Strength</h1>
          <p className="text-xs text-zinc-500 mt-1 leading-relaxed max-w-2xl">
            {stats.sessions} Hevy sessions · {stats.matchedCount} linked to Apple Health workouts via time-window overlap.
            {syncedAt && <span className="text-zinc-600"> · synced {timeAgo(syncedAt)}</span>}
          </p>
        </div>
        <div className="flex items-center gap-3 shrink-0">
          <button
            onClick={sync}
            disabled={syncing}
            className="inline-flex items-center gap-1.5 text-[11px] text-zinc-500 hover:text-zinc-300 transition-colors disabled:opacity-50"
            title="Re-fetch from Hevy"
          >
            {syncing
              ? <><Loader2 size={12} className="animate-spin" /> Syncing{progress ? ` ${progress.fetched}/${progress.total}` : ''}</>
              : <><RefreshCw size={12} /> Refresh</>}
          </button>
          <button
            onClick={disconnect}
            className="inline-flex items-center gap-1.5 text-[11px] text-zinc-500 hover:text-zinc-300 transition-colors"
          >
            <Unplug size={12} /> Disconnect
          </button>
        </div>
      </div>

      <SectionHeader>At a Glance</SectionHeader>
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-3">
        <Stat label="Sessions" value={`${stats.sessions}`} />
        <Stat label="Total Volume" value={fmt(stats.totalVolume)} unit="kg" color={COLORS.purple} />
        <Stat label="Total Sets" value={`${stats.totalSets}`} color={COLORS.blue} />
        <Stat label="Total Reps" value={fmt(stats.totalReps)} color={COLORS.cyan} />
        <Stat label="Avg Duration" value={fmt(stats.avgDurationMin)} unit="min" />
      </div>

      <SectionHeader>Weekly Volume</SectionHeader>
      <div className="bg-zinc-900 rounded-xl p-4 h-64">
        <ResponsiveContainer width="100%" height="100%" minWidth={0} debounce={1}>
          <BarChart data={weeklyVolume} margin={chartMargin}>
            <CartesianGrid strokeDasharray="3 3" stroke={ct.grid} vertical={false} />
            <XAxis dataKey="week" tickFormatter={shortDateCompact} stroke={ct.tick} fontSize={11} tickLine={false} axisLine={false} />
            <YAxis stroke={ct.tick} fontSize={11} tickLine={false} axisLine={false} />
            <Tooltip content={<ChartTooltip formatter={(v) => [`${v} kg`, 'Volume']} />} />
            <Bar dataKey="volume" fill={COLORS.purple} radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>

      <SectionHeader>Top Exercises by Volume</SectionHeader>
      <div className="bg-zinc-900 rounded-xl p-4 h-80">
        <ResponsiveContainer width="100%" height="100%" minWidth={0} debounce={1}>
          <BarChart data={topExercises} layout="vertical" margin={{ top: 5, right: 16, bottom: 0, left: 8 }}>
            <CartesianGrid strokeDasharray="3 3" stroke={ct.grid} horizontal={false} />
            <XAxis type="number" stroke={ct.tick} fontSize={11} tickLine={false} axisLine={false} />
            <YAxis dataKey="title" type="category" stroke={ct.tick} fontSize={11} width={180} tickLine={false} axisLine={false} interval={0} />
            <Tooltip content={<ChartTooltip formatter={(v) => [`${v} kg`, 'Volume']} />} />
            <Bar dataKey="volume" fill={COLORS.green} radius={[0, 4, 4, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/* ── Exercise selector for per-exercise charts ── */}
      {exerciseList.length > 0 && (
        <div className="flex items-center gap-3">
          <span className="text-[11px] font-medium tracking-wider uppercase text-zinc-500">Exercise</span>
          <select
            value={selectedExercise ?? ''}
            onChange={e => setSelectedExercise(e.target.value)}
            className="bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-1.5 text-sm text-zinc-200 focus:outline-none focus:border-zinc-500"
          >
            {exerciseList.map(name => (
              <option key={name} value={name}>{name}</option>
            ))}
          </select>
        </div>
      )}

      {/* ── Chart 1: Volume by Muscle Group (stacked weekly bar) ── */}
      <MuscleGroupChart entries={entries} unmatchedHevy={unmatchedHevy} ct={ct} />

      {/* ── Chart 2: Per-exercise e1RM trend ── */}
      {selectedExercise && (
        <E1RMTrendChart entries={entries} unmatchedHevy={unmatchedHevy} exercise={selectedExercise} ct={ct} />
      )}

      {/* ── Chart 3: Set/Rep Heatmap ── */}
      {selectedExercise && (
        <SetRepHeatmap entries={entries} unmatchedHevy={unmatchedHevy} exercise={selectedExercise} />
      )}

      {/* ── Chart 4: RPE Calibration scatter ── */}
      {selectedExercise && (
        <RPECalibrationChart entries={entries} unmatchedHevy={unmatchedHevy} exercise={selectedExercise} ct={ct} />
      )}

      {/* ── Chart 5: Body Weight vs Top Lifts ── */}
      <BodyWeightVsLiftsChart entries={entries} unmatchedHevy={unmatchedHevy} data={data} ct={ct} />

      {/* ── Chart 6: Volume vs HRV (recovery scatter) ── */}
      <RecoveryVsVolumeChart entries={entries} data={data} ct={ct} />

      {/* ── Chart 7: Weekly Tonnage vs Resting HR ── */}
      <TonnageVsRHRChart entries={entries} data={data} ct={ct} />

      {/* ── Chart 8: Calorie Reconciliation ── */}
      <CalorieReconciliationChart entries={entries} ct={ct} />

      {/* ── Charts 9 & 10: HR Zones + HR Overlay for most recent matched session ── */}
      <HRZonesAndOverlay entries={entries} data={data} ct={ct} />

      {/* ── Chart 11: Tonnage Calendar ── */}
      <TonnageCalendar entries={entries} unmatchedHevy={unmatchedHevy} />

      {/* ── Chart 12: Weekday × Hour heatmap ── */}
      <ScheduleHeatmap entries={entries} unmatchedHevy={unmatchedHevy} />

      <SectionHeader>Sessions</SectionHeader>
      <div className="space-y-2">
        {entries.map(e => {
          const isOpen = expanded.has(e.hevy.id)
          const dateLabel = new Date(e.hevy.startDate).toLocaleDateString(undefined, {
            weekday: 'short', month: 'short', day: 'numeric', year: 'numeric',
          })
          return (
            <div key={e.hevy.id} className="bg-zinc-900 rounded-xl overflow-hidden">
              <button
                onClick={() => toggle(e.hevy.id)}
                className="w-full flex items-center gap-3 px-4 py-3 hover:bg-zinc-800/40 transition-colors text-left"
              >
                <span className="text-zinc-500 shrink-0">
                  {isOpen ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-medium text-zinc-100 truncate">{e.hevy.title}</span>
                    {e.apple ? (
                      <span className="inline-flex items-center gap-1 text-[10px] uppercase tracking-wider text-green-400 bg-green-500/10 ring-1 ring-green-500/25 rounded px-1.5 py-0.5">
                        <Watch size={10} /> Linked
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-[10px] uppercase tracking-wider text-zinc-500 bg-zinc-800 ring-1 ring-zinc-700 rounded px-1.5 py-0.5">
                        <Link2Off size={10} /> Hevy only
                      </span>
                    )}
                  </div>
                  <div className="text-[11px] text-zinc-500 mt-0.5 tabular-nums">
                    {dateLabel} · {fmt(e.hevy.durationMin)} min · {e.hevy.exercises.length} exercises · {e.hevy.totalSets} sets · {fmt(e.hevy.totalVolumeKg)} kg
                  </div>
                </div>
                {e.apple?.hrAvg != null && (
                  <span className="text-[11px] text-zinc-400 tabular-nums shrink-0">
                    {Math.round(e.apple.hrAvg)} bpm avg
                  </span>
                )}
              </button>
              {isOpen && (
                <SessionDetail
                  entry={e}
                  exerciseHistory={exerciseHistory}
                  hrTimeline={data.hrTimeline}
                  maxHR={maxHR}
                  ct={ct}
                />
              )}
            </div>
          )
        })}
      </div>
    </>
  )
}

// ─── Chart 1: Volume by Muscle Group (stacked weekly bar) ───────────────────

function MuscleGroupChart({
  entries, unmatchedHevy, ct,
}: {
  entries: StrengthEntry[]
  unmatchedHevy: HevyWorkout[]
  ct: ReturnType<typeof useChartTheme>
}) {
  const { data, muscles } = useMemo(() => {
    const weekMap = new Map<string, Map<string, number>>()
    const muscleSet = new Set<string>()

    for (const e of entries) {
      const wk = startOfIsoWeek(e.hevy.startDate)
      if (!weekMap.has(wk)) weekMap.set(wk, new Map())
      for (const ex of e.hevy.exercises) {
        const mg = ex.primaryMuscleGroup?.toLowerCase() ?? 'other'
        muscleSet.add(mg)
        const wkMap = weekMap.get(wk)!
        wkMap.set(mg, (wkMap.get(mg) ?? 0) + ex.volumeKg)
      }
    }
    for (const h of unmatchedHevy) {
      const wk = startOfIsoWeek(h.startDate)
      if (!weekMap.has(wk)) weekMap.set(wk, new Map())
      for (const ex of h.exercises) {
        const mg = ex.primaryMuscleGroup?.toLowerCase() ?? 'other'
        muscleSet.add(mg)
        const wkMap = weekMap.get(wk)!
        wkMap.set(mg, (wkMap.get(mg) ?? 0) + ex.volumeKg)
      }
    }

    const muscles = [...muscleSet].sort()
    const chartData = [...weekMap.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([week, mmap]) => {
        const row: Record<string, number | string> = { week }
        for (const mg of muscles) row[mg] = Math.round(mmap.get(mg) ?? 0)
        return row
      })

    return { data: chartData, muscles }
  }, [entries, unmatchedHevy])

  if (data.length === 0) return null

  return (
    <>
      <SectionHeader>Volume by Muscle Group</SectionHeader>
      <div className="bg-zinc-900 rounded-xl p-4 h-64">
        <ResponsiveContainer width="100%" height="100%" minWidth={0} debounce={1}>
          <BarChart data={data} margin={chartMargin}>
            <CartesianGrid strokeDasharray="3 3" stroke={ct.grid} vertical={false} />
            <XAxis dataKey="week" tickFormatter={shortDateCompact} stroke={ct.tick} fontSize={11} tickLine={false} axisLine={false} />
            <YAxis stroke={ct.tick} fontSize={11} tickLine={false} axisLine={false} />
            <Tooltip content={<ChartTooltip formatter={(v, name) => [`${v} kg`, name]} />} />
            {muscles.map(mg => (
              <Bar key={mg} dataKey={mg} stackId="a" fill={muscleColor(mg)} />
            ))}
          </BarChart>
        </ResponsiveContainer>
      </div>
    </>
  )
}

// ─── Chart 2: Per-exercise e1RM trend ───────────────────────────────────────

function E1RMTrendChart({
  entries, unmatchedHevy, exercise, ct,
}: {
  entries: StrengthEntry[]
  unmatchedHevy: HevyWorkout[]
  exercise: string
  ct: ReturnType<typeof useChartTheme>
}) {
  const chartData = useMemo(() => {
    const allWorkouts: { startDate: string; exercises: HevyExercise[] }[] = [
      ...entries.map(e => ({ startDate: e.hevy.startDate, exercises: e.hevy.exercises })),
      ...unmatchedHevy.map(h => ({ startDate: h.startDate, exercises: h.exercises })),
    ]

    const points: { date: string; e1rm: number; pr: boolean }[] = []
    let runningBest = 0

    allWorkouts
      .sort((a, b) => a.startDate.localeCompare(b.startDate))
      .forEach(w => {
        const ex = w.exercises.find(e => e.title === exercise)
        if (!ex) return
        const e1 = bestE1RMForExercise(ex)
        if (e1 === 0) return
        const date = localDay(w.startDate)
        const isPR = e1 > runningBest
        if (isPR) runningBest = e1
        points.push({ date, e1rm: Math.round(e1 * 10) / 10, pr: isPR })
      })

    return points
  }, [entries, unmatchedHevy, exercise])

  if (chartData.length === 0) return null

  return (
    <>
      <SectionHeader>{`e1RM — ${exercise}`}</SectionHeader>
      <div className="bg-zinc-900 rounded-xl p-4 h-64">
        <ResponsiveContainer width="100%" height="100%" minWidth={0} debounce={1}>
          <LineChart data={chartData} margin={chartMargin}>
            <CartesianGrid strokeDasharray="3 3" stroke={ct.grid} vertical={false} />
            <XAxis dataKey="date" tickFormatter={shortDateCompact} stroke={ct.tick} fontSize={11} tickLine={false} axisLine={false} />
            <YAxis stroke={ct.tick} fontSize={11} tickLine={false} axisLine={false} />
            <Tooltip content={<ChartTooltip formatter={(v) => [`${v} kg`, 'e1RM']} />} />
            <Line
              type="monotone"
              dataKey="e1rm"
              stroke={COLORS.blue}
              strokeWidth={2}
              dot={{ r: 3, fill: COLORS.blue }}
              activeDot={{ r: 5 }}
            />
            {chartData.filter(d => d.pr).map(d => (
              <ReferenceDot
                key={d.date}
                x={d.date}
                y={d.e1rm}
                r={4}
                fill={COLORS.green}
                stroke="none"
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>
    </>
  )
}

// ─── Chart 3: Set/Rep Heatmap ────────────────────────────────────────────────

function SetRepHeatmap({
  entries, unmatchedHevy, exercise,
}: {
  entries: StrengthEntry[]
  unmatchedHevy: HevyWorkout[]
  exercise: string
}) {
  const { grid, weights, maxRep, maxCount } = useMemo(() => {
    const countMap = new Map<string, number>()
    let maxRep = 1

    const allWorkouts = [
      ...entries.map(e => e.hevy),
      ...unmatchedHevy,
    ]

    for (const w of allWorkouts) {
      for (const ex of w.exercises) {
        if (ex.title !== exercise) continue
        for (const s of ex.sets) {
          if (s.type === 'warmup' || s.type === 'dropset') continue
          if (s.weightKg == null || s.reps == null || s.reps < 1) continue
          // bucket weight to nearest 2.5 kg
          const bucket = Math.round(s.weightKg / 2.5) * 2.5
          const key = `${bucket}|${s.reps}`
          countMap.set(key, (countMap.get(key) ?? 0) + 1)
          if (s.reps > maxRep) maxRep = s.reps
        }
      }
    }

    const weightSet = new Set<number>()
    for (const key of countMap.keys()) {
      weightSet.add(parseFloat(key.split('|')[0]))
    }
    const weights = [...weightSet].sort((a, b) => b - a) // desc

    let maxCount = 1
    for (const v of countMap.values()) if (v > maxCount) maxCount = v

    const grid: { weight: number; rep: number; count: number }[][] = weights.map(w =>
      Array.from({ length: maxRep }, (_, i) => ({
        weight: w,
        rep: i + 1,
        count: countMap.get(`${w}|${i + 1}`) ?? 0,
      }))
    )

    return { grid, weights, maxRep, maxCount }
  }, [entries, unmatchedHevy, exercise])

  if (weights.length === 0) return null

  return (
    <>
      <SectionHeader>Set/Rep Heatmap</SectionHeader>
      <div className="bg-zinc-900 rounded-xl p-4 overflow-auto">
        <div className="mb-1 flex items-center gap-1" style={{ marginLeft: 56 }}>
          {Array.from({ length: maxRep }, (_, i) => (
            <div key={i} className="text-[10px] text-zinc-500 text-center" style={{ width: 28, flexShrink: 0 }}>
              {i + 1}
            </div>
          ))}
          <div className="text-[10px] text-zinc-500 ml-1">reps</div>
        </div>
        <div className="space-y-0.5">
          {grid.map((row, ri) => (
            <div key={weights[ri]} className="flex items-center gap-1">
              <div className="text-[10px] text-zinc-500 text-right tabular-nums" style={{ width: 48, flexShrink: 0 }}>
                {weights[ri]} kg
              </div>
              {row.map(cell => (
                <div
                  key={cell.rep}
                  title={cell.count > 0 ? `${cell.weight} kg × ${cell.rep} reps: ${cell.count}×` : undefined}
                  className="rounded-sm flex items-center justify-center text-[9px] tabular-nums font-medium"
                  style={{
                    width: 28,
                    height: 22,
                    flexShrink: 0,
                    background: cell.count > 0
                      ? `${COLORS.purple}${Math.round((cell.count / maxCount) * 0.85 * 255 + 30).toString(16).padStart(2, '0')}`
                      : 'transparent',
                    color: cell.count > 0 ? '#e4e4e7' : 'transparent',
                    border: '1px solid #27272a',
                  }}
                >
                  {cell.count > 0 ? cell.count : ''}
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>
    </>
  )
}

// ─── Chart 4: RPE Calibration scatter ───────────────────────────────────────

function RPECalibrationChart({
  entries, unmatchedHevy, exercise, ct,
}: {
  entries: StrengthEntry[]
  unmatchedHevy: HevyWorkout[]
  exercise: string
  ct: ReturnType<typeof useChartTheme>
}) {
  const { scatterData, refLineData } = useMemo(() => {
    const allWorkouts = [
      ...entries.map(e => e.hevy),
      ...unmatchedHevy,
    ]

    const scatterData: { x: number; y: number }[] = []

    for (const w of allWorkouts) {
      for (const ex of w.exercises) {
        if (ex.title !== exercise) continue
        const sessionBest = bestE1RMForExercise(ex)
        if (sessionBest === 0) continue
        for (const s of ex.sets) {
          if (s.type === 'warmup') continue
          if (s.weightKg == null || s.reps == null || s.rpe == null) continue
          const pct = (s.weightKg / sessionBest) * 100
          scatterData.push({ x: Math.round(pct * 10) / 10, y: s.rpe })
        }
      }
    }

    // Reference line: expected = 60 + (rpe-1)*4.4 → rpe = (expected - 60)/4.4 + 1
    // We'll draw points from RPE 6 to 10
    const refLineData: { x: number; y: number }[] = []
    for (let rpe = 6; rpe <= 10; rpe += 0.5) {
      const expectedPct = 60 + (rpe - 1) * 4.4
      refLineData.push({ x: Math.round(expectedPct * 10) / 10, y: rpe })
    }

    return { scatterData, refLineData }
  }, [entries, unmatchedHevy, exercise])

  if (scatterData.length === 0) return null

  return (
    <>
      <SectionHeader>RPE Calibration</SectionHeader>
      <div className="bg-zinc-900 rounded-xl p-4 h-64">
        <ResponsiveContainer width="100%" height="100%" minWidth={0} debounce={1}>
          <ScatterChart margin={chartMargin}>
            <CartesianGrid strokeDasharray="3 3" stroke={ct.grid} />
            <XAxis
              dataKey="x"
              type="number"
              name="% e1RM"
              domain={[50, 110]}
              stroke={ct.tick}
              fontSize={11}
              tickLine={false}
              axisLine={false}
              label={{ value: '% e1RM', position: 'insideBottomRight', offset: -4, fontSize: 10, fill: ct.tick }}
            />
            <YAxis
              dataKey="y"
              type="number"
              name="RPE"
              domain={[5, 11]}
              stroke={ct.tick}
              fontSize={11}
              tickLine={false}
              axisLine={false}
              label={{ value: 'RPE', angle: -90, position: 'insideLeft', offset: 12, fontSize: 10, fill: ct.tick }}
            />
            <Tooltip cursor={{ strokeDasharray: '3 3' }} content={<ChartTooltip formatter={(v, name) => [`${v}`, name]} />} />
            {/* Reference curve */}
            <Scatter data={refLineData} fill={COLORS.zinc} opacity={0.5} line={{ stroke: COLORS.zinc, strokeWidth: 1, strokeDasharray: '4 2' }} lineType="fitting" />
            {/* Actual data */}
            <Scatter data={scatterData} fill={COLORS.orange} opacity={0.7} />
          </ScatterChart>
        </ResponsiveContainer>
      </div>
    </>
  )
}

// ─── Chart 5: Body Weight vs Top Lifts ──────────────────────────────────────

function BodyWeightVsLiftsChart({
  entries, unmatchedHevy, data, ct,
}: {
  entries: StrengthEntry[]
  unmatchedHevy: HevyWorkout[]
  data: HealthData
  ct: ReturnType<typeof useChartTheme>
}) {
  const { chartData, topExNames } = useMemo(() => {
    const bodyRecords = data.bodyRecords.filter(r => r.weight != null)
    if (bodyRecords.length === 0) return { chartData: [], topExNames: [] }

    // Top 3 exercises by session frequency
    const freqMap = new Map<string, number>()
    const allWorkouts = [
      ...entries.map(e => e.hevy),
      ...unmatchedHevy,
    ]
    for (const w of allWorkouts) {
      const seen = new Set<string>()
      for (const ex of w.exercises) {
        if (!seen.has(ex.title)) {
          freqMap.set(ex.title, (freqMap.get(ex.title) ?? 0) + 1)
          seen.add(ex.title)
        }
      }
    }
    const top3 = [...freqMap.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([name]) => name)

    // e1RM per session per exercise
    const e1rmByDateEx = new Map<string, Map<string, number>>()
    for (const w of allWorkouts) {
      const day = localDay(w.startDate)
      if (!e1rmByDateEx.has(day)) e1rmByDateEx.set(day, new Map())
      for (const ex of w.exercises) {
        if (!top3.includes(ex.title)) continue
        const prev = e1rmByDateEx.get(day)!.get(ex.title) ?? 0
        const curr = bestE1RMForExercise(ex)
        if (curr > prev) e1rmByDateEx.get(day)!.set(ex.title, curr)
      }
    }

    // Body weight by date
    const weightByDate = new Map<string, number>()
    for (const r of bodyRecords) if (r.weight != null) weightByDate.set(r.date, r.weight)

    // Merge dates
    const allDates = new Set([
      ...e1rmByDateEx.keys(),
      ...weightByDate.keys(),
    ])
    const sorted = [...allDates].sort()

    const chartData = sorted.map(date => {
      const row: Record<string, number | string | null> = { date }
      for (const ex of top3) {
        row[ex] = e1rmByDateEx.get(date)?.get(ex) ?? null
      }
      row['bodyWeight'] = weightByDate.get(date) ?? null
      return row
    })

    return { chartData, topExNames: top3 }
  }, [entries, unmatchedHevy, data])

  if (chartData.length === 0 || topExNames.length === 0) return null

  const exColors = [COLORS.blue, COLORS.green, COLORS.cyan]

  return (
    <>
      <SectionHeader>Body Weight vs Top Lifts</SectionHeader>
      <div className="bg-zinc-900 rounded-xl p-4 h-64">
        <ResponsiveContainer width="100%" height="100%" minWidth={0} debounce={1}>
          <LineChart data={chartData} margin={chartMargin}>
            <CartesianGrid strokeDasharray="3 3" stroke={ct.grid} vertical={false} />
            <XAxis dataKey="date" tickFormatter={shortDateCompact} stroke={ct.tick} fontSize={11} tickLine={false} axisLine={false} />
            <YAxis yAxisId="left" stroke={ct.tick} fontSize={11} tickLine={false} axisLine={false} />
            <YAxis yAxisId="right" orientation="right" stroke={ct.tick} fontSize={11} tickLine={false} axisLine={false} />
            <Tooltip content={<ChartTooltip formatter={(v, name) => [`${typeof v === 'number' ? v.toFixed(1) : v} ${name === 'bodyWeight' ? 'kg bw' : 'kg e1RM'}`, name === 'bodyWeight' ? 'Body Weight' : name]} />} />
            {topExNames.map((name, i) => (
              <Line
                key={name}
                yAxisId="left"
                type="monotone"
                dataKey={name}
                stroke={exColors[i] ?? COLORS.blue}
                strokeWidth={1.5}
                dot={false}
                connectNulls
              />
            ))}
            <Line
              yAxisId="right"
              type="monotone"
              dataKey="bodyWeight"
              stroke={COLORS.orange}
              strokeWidth={1.5}
              strokeDasharray="4 2"
              dot={false}
              connectNulls
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </>
  )
}

// ─── Chart 6: Volume vs HRV ──────────────────────────────────────────────────

function RecoveryVsVolumeChart({
  entries, data, ct,
}: {
  entries: StrengthEntry[]
  data: HealthData
  ct: ReturnType<typeof useChartTheme>
}) {
  const { scatterData, r } = useMemo(() => {
    const scatterData: { x: number; y: number }[] = []
    const xs: number[] = []
    const ys: number[] = []

    for (const e of entries) {
      const day = localDay(e.hevy.startDate)
      // Try current day then day before
      const hrv = data.dailyMetrics.get(day)?.hrv
        ?? data.dailyMetrics.get(prevDay(day))?.hrv
      if (hrv == null) continue
      scatterData.push({ x: hrv, y: Math.round(e.hevy.totalVolumeKg) })
      xs.push(hrv)
      ys.push(e.hevy.totalVolumeKg)
    }

    const r = pearsonR(xs, ys)
    return { scatterData, r }
  }, [entries, data])

  if (scatterData.length < 3) return null

  return (
    <>
      <SectionHeader>Recovery vs Volume</SectionHeader>
      <p className="text-[11px] text-zinc-500 -mt-3 mb-2">
        Pearson r = {r.toFixed(2)} between prior night HRV and session tonnage.
      </p>
      <div className="bg-zinc-900 rounded-xl p-4 h-64">
        <ResponsiveContainer width="100%" height="100%" minWidth={0} debounce={1}>
          <ScatterChart margin={chartMargin}>
            <CartesianGrid strokeDasharray="3 3" stroke={ct.grid} />
            <XAxis
              dataKey="x"
              type="number"
              name="HRV"
              stroke={ct.tick}
              fontSize={11}
              tickLine={false}
              axisLine={false}
              label={{ value: 'HRV (ms)', position: 'insideBottomRight', offset: -4, fontSize: 10, fill: ct.tick }}
            />
            <YAxis
              dataKey="y"
              type="number"
              name="Volume"
              stroke={ct.tick}
              fontSize={11}
              tickLine={false}
              axisLine={false}
              label={{ value: 'Volume (kg)', angle: -90, position: 'insideLeft', offset: 12, fontSize: 10, fill: ct.tick }}
            />
            <Tooltip cursor={{ strokeDasharray: '3 3' }} content={<ChartTooltip formatter={(v, name) => [`${v}${name === 'HRV' ? ' ms' : ' kg'}`, name]} />} />
            <Scatter data={scatterData} fill={COLORS.cyan} opacity={0.7} />
          </ScatterChart>
        </ResponsiveContainer>
      </div>
    </>
  )
}

function prevDay(iso: string): string {
  const d = new Date(iso)
  d.setDate(d.getDate() - 1)
  return localDay(d.toISOString())
}

// ─── Chart 7: Weekly Tonnage vs Resting HR ──────────────────────────────────

function TonnageVsRHRChart({
  entries, data, ct,
}: {
  entries: StrengthEntry[]
  data: HealthData
  ct: ReturnType<typeof useChartTheme>
}) {
  const chartData = useMemo(() => {
    const weekTonnage = new Map<string, number>()
    for (const e of entries) {
      const wk = startOfIsoWeek(e.hevy.startDate)
      weekTonnage.set(wk, (weekTonnage.get(wk) ?? 0) + e.hevy.totalVolumeKg)
    }

    const weekRHR = new Map<string, number[]>()
    for (const [date, dm] of Array.from(data.dailyMetrics.entries())) {
      if (dm.restingHeartRate == null) continue
      const wk = startOfIsoWeek(date)
      if (!weekRHR.has(wk)) weekRHR.set(wk, [])
      weekRHR.get(wk)!.push(dm.restingHeartRate)
    }

    const weeks = [...new Set([...weekTonnage.keys(), ...weekRHR.keys()])].sort()
    return weeks
      .filter(wk => weekTonnage.has(wk))
      .map(wk => {
        const rhrArr = weekRHR.get(wk) ?? []
        const rhr = rhrArr.length > 0 ? rhrArr.reduce((a, b) => a + b, 0) / rhrArr.length : null
        return {
          week: wk,
          tonnage: Math.round(weekTonnage.get(wk) ?? 0),
          rhr: rhr != null ? Math.round(rhr * 10) / 10 : null,
        }
      })
  }, [entries, data])

  if (chartData.length === 0) return null

  return (
    <>
      <SectionHeader>Weekly Tonnage vs Resting HR</SectionHeader>
      <div className="bg-zinc-900 rounded-xl p-4 h-64">
        <ResponsiveContainer width="100%" height="100%" minWidth={0} debounce={1}>
          <ComposedChart data={chartData} margin={chartMargin}>
            <CartesianGrid strokeDasharray="3 3" stroke={ct.grid} vertical={false} />
            <XAxis dataKey="week" tickFormatter={shortDateCompact} stroke={ct.tick} fontSize={11} tickLine={false} axisLine={false} />
            <YAxis yAxisId="left" stroke={ct.tick} fontSize={11} tickLine={false} axisLine={false} />
            <YAxis yAxisId="right" orientation="right" stroke={ct.tick} fontSize={11} tickLine={false} axisLine={false} />
            <Tooltip content={<ChartTooltip formatter={(v, name) => name === 'tonnage' ? [`${v} kg`, 'Tonnage'] : [`${v} bpm`, 'Resting HR']} />} />
            <Bar yAxisId="left" dataKey="tonnage" fill={COLORS.purple} radius={[4, 4, 0, 0]} opacity={0.8} />
            <Line yAxisId="right" type="monotone" dataKey="rhr" stroke={COLORS.red} strokeWidth={2} dot={{ r: 3, fill: COLORS.red }} connectNulls />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </>
  )
}

// ─── Chart 8: Calorie Reconciliation ────────────────────────────────────────

function CalorieReconciliationChart({
  entries, ct,
}: {
  entries: StrengthEntry[]
  ct: ReturnType<typeof useChartTheme>
}) {
  const chartData = useMemo(() => {
    // Only matched sessions with Apple calories
    const matched = entries
      .filter(e => e.apple != null && e.apple.calories > 0)
      .slice(0, 12)
      .reverse() // chronological
      .map(e => {
        // Rough estimate: 0.05 * totalVolumeKg + 5 * totalSets
        // (volume-based rule of thumb; not a medical calculation)
        const estimated = Math.round(0.05 * e.hevy.totalVolumeKg + 5 * e.hevy.totalSets)
        const day = localDay(e.hevy.startDate)
        return {
          date: day,
          apple: Math.round(e.apple!.calories),
          estimated,
        }
      })
    return matched
  }, [entries])

  if (chartData.length === 0) return null

  return (
    <>
      <SectionHeader>Calorie Estimate: Apple vs Volume-derived</SectionHeader>
      <div className="bg-zinc-900 rounded-xl p-4 h-64">
        <ResponsiveContainer width="100%" height="100%" minWidth={0} debounce={1}>
          <BarChart data={chartData} margin={chartMargin}>
            <CartesianGrid strokeDasharray="3 3" stroke={ct.grid} vertical={false} />
            <XAxis dataKey="date" tickFormatter={shortDateCompact} stroke={ct.tick} fontSize={11} tickLine={false} axisLine={false} />
            <YAxis stroke={ct.tick} fontSize={11} tickLine={false} axisLine={false} />
            <Tooltip content={<ChartTooltip formatter={(v, name) => [`${v} kcal`, name === 'apple' ? 'Apple Health' : 'Volume estimate']} />} />
            <Bar dataKey="apple" fill={COLORS.green} radius={[4, 4, 0, 0]} />
            <Bar dataKey="estimated" fill={COLORS.purple} radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </>
  )
}

// ─── Charts 9 & 10: HR Zones + HR Overlay ────────────────────────────────────

function HRZonesAndOverlay({
  entries, data, ct,
}: {
  entries: StrengthEntry[]
  data: HealthData
  ct: ReturnType<typeof useChartTheme>
}) {
  const result = useMemo(() => {
    const age = ageFromDob(data.profile.dob)
    const maxHR = 220 - age

    // Find most recent matched session with HR samples
    for (const e of entries) {
      if (!e.apple) continue
      const start = +new Date(e.hevy.startDate)
      const end = +new Date(e.hevy.endDate)
      const samples = data.hrTimeline.filter(s => s.t >= start && s.t <= end)
      if (samples.length === 0) continue

      // Zone boundaries
      const z = [
        { min: 0.5 * maxHR, max: 0.6 * maxHR, label: 'Z1', color: COLORS.zinc },
        { min: 0.6 * maxHR, max: 0.7 * maxHR, label: 'Z2', color: COLORS.blue },
        { min: 0.7 * maxHR, max: 0.8 * maxHR, label: 'Z3', color: COLORS.green },
        { min: 0.8 * maxHR, max: 0.9 * maxHR, label: 'Z4', color: COLORS.orange },
        { min: 0.9 * maxHR, max: Infinity, label: 'Z5', color: COLORS.red },
      ]

      // Each sample represents roughly the interval to the next (or 5s default)
      const zoneMins: number[] = [0, 0, 0, 0, 0]
      for (let i = 0; i < samples.length; i++) {
        const bpm = samples[i].v
        const intervalMs = i < samples.length - 1 ? samples[i + 1].t - samples[i].t : 5000
        const mins = intervalMs / 60000
        for (let zi = 0; zi < z.length; zi++) {
          if (bpm >= z[zi].min && bpm < z[zi].max) {
            zoneMins[zi] += mins
            break
          }
        }
      }

      // HR overlay data
      const hrLine = samples.map(s => ({
        min: (s.t - start) / 60000,
        bpm: s.v,
      }))

      const sessionDate = localDay(e.hevy.startDate)

      return { zoneMins, zoneColors: z.map(zi => zi.color), zoneLabels: z.map(zi => zi.label), hrLine, sessionDate, hasSamples: true }
    }

    // Check most recent matched entry without samples
    const firstMatched = entries.find(e => e.apple)
    if (firstMatched) {
      const sessionDate = localDay(firstMatched.hevy.startDate)
      return { zoneMins: [0, 0, 0, 0, 0], zoneColors: [], zoneLabels: [], hrLine: [], sessionDate, hasSamples: false }
    }

    return null
  }, [entries, data])

  if (!result) return null

  const totalZoneMin = result.zoneMins.reduce((a, b) => a + b, 0)

  return (
    <>
      <SectionHeader>{`HR Zones — ${result.sessionDate}`}</SectionHeader>
      {!result.hasSamples ? (
        <div className="text-[11px] text-zinc-500 italic">No watch HR data for this session.</div>
      ) : (
        <>
          {/* Stacked horizontal bar */}
          <div className="bg-zinc-900 rounded-xl p-4">
            <div className="flex w-full h-8 rounded-lg overflow-hidden gap-px">
              {result.zoneMins.map((mins, i) => {
                const pct = totalZoneMin > 0 ? (mins / totalZoneMin) * 100 : 0
                if (pct < 0.5) return null
                return (
                  <div
                    key={i}
                    title={`${result.zoneLabels[i]}: ${mins.toFixed(1)} min`}
                    style={{ width: `${pct}%`, background: result.zoneColors[i], opacity: 0.85 }}
                    className="flex items-center justify-center text-[10px] font-medium text-white/80"
                  >
                    {pct > 5 ? result.zoneLabels[i] : ''}
                  </div>
                )
              })}
            </div>
            <div className="flex gap-4 mt-2 flex-wrap">
              {result.zoneMins.map((mins, i) => (
                <div key={i} className="flex items-center gap-1.5 text-[11px] text-zinc-400">
                  <div className="w-2.5 h-2.5 rounded-sm" style={{ background: result.zoneColors[i] }} />
                  {result.zoneLabels[i]} {mins.toFixed(1)} min
                </div>
              ))}
            </div>
          </div>

          {result.hrLine.length > 0 && (
            <>
              <SectionHeader>{`Heart Rate — ${result.sessionDate}`}</SectionHeader>
              <div className="bg-zinc-900 rounded-xl p-4 h-64">
                <ResponsiveContainer width="100%" height="100%" minWidth={0} debounce={1}>
                  <LineChart data={result.hrLine} margin={chartMargin}>
                    <CartesianGrid strokeDasharray="3 3" stroke={ct.grid} vertical={false} />
                    <XAxis
                      dataKey="min"
                      stroke={ct.tick}
                      fontSize={11}
                      tickLine={false}
                      axisLine={false}
                      tickFormatter={(v: number) => `${Math.round(v)}m`}
                    />
                    <YAxis stroke={ct.tick} fontSize={11} tickLine={false} axisLine={false} />
                    <Tooltip content={<ChartTooltip formatter={(v) => [`${v} bpm`, 'HR']} />} />
                    <Line
                      type="monotone"
                      dataKey="bpm"
                      stroke={COLORS.red}
                      strokeWidth={1.5}
                      dot={false}
                    />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </>
          )}
        </>
      )}
    </>
  )
}

// ─── Chart 11: Tonnage Calendar ──────────────────────────────────────────────

function TonnageCalendar({
  entries, unmatchedHevy,
}: {
  entries: StrengthEntry[]
  unmatchedHevy: HevyWorkout[]
}) {
  const { weeks, p95 } = useMemo(() => {
    // Build tonnage map by day
    const tonnageByDay = new Map<string, number>()
    const allWorkouts = [
      ...entries.map(e => e.hevy),
      ...unmatchedHevy,
    ]
    for (const w of allWorkouts) {
      const day = localDay(w.startDate)
      tonnageByDay.set(day, (tonnageByDay.get(day) ?? 0) + w.totalVolumeKg)
    }

    // Build 53 weeks of calendar, Mon-Sun rows
    const today = new Date()
    // End of current week (Sunday)
    const endSunday = new Date(today)
    const todayDow = (today.getDay() + 6) % 7 // 0=Mon..6=Sun
    endSunday.setDate(today.getDate() + (6 - todayDow))

    const weeks: { date: string; tonnage: number | null }[][] = []
    for (let w = 52; w >= 0; w--) {
      const week: { date: string; tonnage: number | null }[] = []
      for (let d = 0; d < 7; d++) {
        const cell = new Date(endSunday)
        cell.setDate(endSunday.getDate() - w * 7 - (6 - d))
        const iso = localDay(cell.toISOString())
        const future = cell > today
        week.push({ date: iso, tonnage: future ? null : (tonnageByDay.get(iso) ?? 0) })
      }
      weeks.push(week)
    }

    // p95 of non-zero tonnage values
    const vals = [...tonnageByDay.values()].filter(v => v > 0).sort((a, b) => a - b)
    const p95 = vals.length > 0 ? vals[Math.floor(vals.length * 0.95)] : 1

    return { weeks, p95 }
  }, [entries, unmatchedHevy])

  const DAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

  return (
    <>
      <SectionHeader>Tonnage Calendar</SectionHeader>
      <div className="bg-zinc-900 rounded-xl p-4 overflow-auto">
        <div className="flex gap-0.5">
          {/* Day labels */}
          <div className="flex flex-col gap-0.5 mr-1">
            {DAY_LABELS.map(d => (
              <div key={d} className="text-[9px] text-zinc-600 h-3.5 flex items-center pr-1">{d}</div>
            ))}
          </div>
          {/* Week columns */}
          {weeks.map((week, wi) => (
            <div key={wi} className="flex flex-col gap-0.5">
              {week.map((cell, di) => {
                if (cell.tonnage === null) {
                  return <div key={di} className="w-3.5 h-3.5 rounded-sm bg-zinc-800/30" />
                }
                const opacity = cell.tonnage === 0 ? 0 : Math.min(1, cell.tonnage / p95)
                const hex = Math.round(opacity * 200 + 10).toString(16).padStart(2, '0')
                return (
                  <div
                    key={di}
                    title={cell.tonnage > 0 ? `${cell.date}: ${Math.round(cell.tonnage)} kg` : cell.date}
                    className="w-3.5 h-3.5 rounded-sm"
                    style={{
                      background: cell.tonnage > 0 ? `${COLORS.purple}${hex}` : '#27272a',
                    }}
                  />
                )
              })}
            </div>
          ))}
        </div>
        <div className="flex items-center gap-2 mt-2">
          <span className="text-[10px] text-zinc-600">Less</span>
          {[0.1, 0.3, 0.5, 0.75, 1].map((o, i) => {
            const hex = Math.round(o * 200 + 10).toString(16).padStart(2, '0')
            return (
              <div key={i} className="w-3.5 h-3.5 rounded-sm" style={{ background: `${COLORS.purple}${hex}` }} />
            )
          })}
          <span className="text-[10px] text-zinc-600">More</span>
        </div>
      </div>
    </>
  )
}

// ─── Chart 12: Weekday × Hour heatmap ───────────────────────────────────────

function ScheduleHeatmap({
  entries,
  unmatchedHevy,
}: {
  entries: StrengthEntry[]
  unmatchedHevy: HevyWorkout[]
}) {
  const cells = useMemo(() => {
    // grid[day 0=Mon..6=Sun][hour 0..23] = { sessions, volume }
    const grid: { sessions: number; volume: number }[][] = Array.from({ length: 7 }, () =>
      Array.from({ length: 24 }, () => ({ sessions: 0, volume: 0 })),
    )
    const all = [...entries.map(e => e.hevy), ...unmatchedHevy]
    for (const h of all) {
      const d = new Date(h.startDate)
      const dow = (d.getDay() + 6) % 7 // Mon=0
      const hr = d.getHours()
      grid[dow][hr].sessions += 1
      grid[dow][hr].volume += h.totalVolumeKg
    }
    return grid
  }, [entries, unmatchedHevy])

  const max = useMemo(() => {
    let m = 0
    for (const row of cells) for (const c of row) if (c.sessions > m) m = c.sessions
    return m
  }, [cells])

  if (entries.length === 0 && unmatchedHevy.length === 0) return null

  const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
  // Show only "interesting" hours range to keep cells readable (still all 24).
  const HOURS = Array.from({ length: 24 }, (_, i) => i)

  return (
    <>
      <SectionHeader>Training Schedule</SectionHeader>
      <div className="bg-zinc-900 rounded-xl p-4 overflow-x-auto">
        <div className="inline-block min-w-full">
          {/* Hour header */}
          <div className="grid gap-0.5 mb-1" style={{ gridTemplateColumns: '40px repeat(24, minmax(18px, 1fr))' }}>
            <div />
            {HOURS.map(h => (
              <div key={h} className="text-[9px] text-zinc-600 text-center tabular-nums">
                {h % 3 === 0 ? h : ''}
              </div>
            ))}
          </div>
          {DAYS.map((day, dow) => (
            <div key={day} className="grid gap-0.5 mb-0.5" style={{ gridTemplateColumns: '40px repeat(24, minmax(18px, 1fr))' }}>
              <div className="text-[10px] text-zinc-500 self-center pr-2 text-right">{day}</div>
              {HOURS.map(hr => {
                const c = cells[dow][hr]
                const opacity = max > 0 ? c.sessions / max : 0
                const empty = c.sessions === 0
                return (
                  <div
                    key={hr}
                    title={empty ? `${day} ${hr}:00 — no sessions` : `${day} ${hr}:00 — ${c.sessions} session${c.sessions === 1 ? '' : 's'}, ${Math.round(c.volume)} kg`}
                    className="aspect-square rounded-sm"
                    style={{
                      background: empty ? 'rgba(63,63,70,0.35)' : COLORS.purple,
                      opacity: empty ? 1 : 0.25 + opacity * 0.75,
                    }}
                  />
                )
              })}
            </div>
          ))}
        </div>
        <div className="flex items-center gap-2 mt-3 text-[10px] text-zinc-500">
          <span>Less</span>
          {[0.2, 0.4, 0.6, 0.8, 1].map(o => (
            <div key={o} className="w-3 h-3 rounded-sm" style={{ background: COLORS.purple, opacity: 0.25 + o * 0.75 }} />
          ))}
          <span>More</span>
          <span className="ml-auto tabular-nums">peak: {max} session{max === 1 ? '' : 's'}</span>
        </div>
      </div>
    </>
  )
}

// ─── Shared sub-components ───────────────────────────────────────────────────

interface SessionDetailProps {
  entry: StrengthEntry
  exerciseHistory: Map<string, { sessionId: string; sessionStart: string; e1rm: number; volume: number }[]>
  hrTimeline: { t: number; v: number }[]
  maxHR: number
  ct: ReturnType<typeof useChartTheme>
}

function SessionDetail({ entry, exerciseHistory, hrTimeline, maxHR, ct }: SessionDetailProps) {
  const { hevy: h, apple } = entry
  const startMs = +new Date(h.startDate)
  const endMs = +new Date(h.endDate)

  // Working sets/reps (exclude warmups)
  const working = useMemo(() => {
    let sets = 0, reps = 0, vol = 0
    for (const ex of h.exercises) {
      for (const s of ex.sets) {
        if (s.type === 'warmup') continue
        sets++
        reps += s.reps ?? 0
        if (s.weightKg != null && s.reps != null && s.type !== 'dropset') vol += s.weightKg * s.reps
      }
    }
    return { sets, reps, vol }
  }, [h.exercises])

  // HR samples within the session window
  const hrSamples = useMemo(() => {
    if (!hrTimeline.length) return []
    return hrTimeline.filter(s => s.t >= startMs && s.t <= endMs)
      .map(s => ({ min: (s.t - startMs) / 60000, bpm: s.v }))
  }, [hrTimeline, startMs, endMs])

  const hrStats = useMemo(() => {
    if (hrSamples.length === 0) return null
    let sum = 0, mn = Infinity, mx = 0
    for (const s of hrSamples) {
      sum += s.bpm
      if (s.bpm < mn) mn = s.bpm
      if (s.bpm > mx) mx = s.bpm
    }
    return { avg: sum / hrSamples.length, min: mn, max: mx }
  }, [hrSamples])

  // Time in HR zones (minutes), per Karvonen-ish % of maxHR
  const zoneMinutes = useMemo(() => {
    if (hrSamples.length < 2) return null
    const zones = [0, 0, 0, 0, 0] // Z1..Z5
    for (let i = 1; i < hrSamples.length; i++) {
      const dt = hrSamples[i].min - hrSamples[i - 1].min
      const pct = hrSamples[i].bpm / maxHR
      const z = pct < 0.6 ? 0 : pct < 0.7 ? 1 : pct < 0.8 ? 2 : pct < 0.9 ? 3 : 4
      zones[z] += dt
    }
    return zones
  }, [hrSamples, maxHR])

  // Per-muscle-group volume for THIS session
  const muscleVolume = useMemo(() => {
    const m = new Map<string, number>()
    for (const ex of h.exercises) {
      const key = ex.primaryMuscleGroup ?? 'other'
      m.set(key, (m.get(key) ?? 0) + ex.volumeKg)
    }
    return [...m.entries()].sort((a, b) => b[1] - a[1])
  }, [h.exercises])
  const muscleTotal = muscleVolume.reduce((s, [, v]) => s + v, 0)

  // Volume-derived calorie estimate (rough)
  const derivedKcal = Math.round(0.05 * h.totalVolumeKg + 5 * h.totalSets)

  const ZONE_COLORS = [COLORS.zinc, COLORS.blue, COLORS.green, COLORS.orange, COLORS.red]
  const ZONE_LABELS = ['Z1 50-60%', 'Z2 60-70%', 'Z3 70-80%', 'Z4 80-90%', 'Z5 90%+']

  return (
    <div className="px-4 pb-4 pt-1 border-t border-zinc-800/60 space-y-4">
      {h.description && (
        <p className="text-xs text-zinc-300 italic bg-zinc-950/50 rounded-lg px-3 py-2">"{h.description}"</p>
      )}

      {/* Stats strip */}
      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-2">
        <Chip label="Volume" value={fmt(h.totalVolumeKg)} unit="kg" color={COLORS.purple} />
        <Chip label="Working Sets" value={`${working.sets}`} sub={`/ ${h.totalSets} total`} color={COLORS.blue} />
        <Chip label="Working Reps" value={`${working.reps}`} color={COLORS.cyan} />
        <Chip label="Duration" value={fmt(h.durationMin)} unit="min" />
        {apple?.calories ? (
          <Chip label="Calories (Apple)" value={`${Math.round(apple.calories)}`} unit="kcal" color={COLORS.orange} />
        ) : (
          <Chip label="Est. Calories" value={`${derivedKcal}`} unit="kcal" color={COLORS.orange} sub="from volume" />
        )}
        {apple?.avgMETs != null && <Chip label="Avg METs" value={apple.avgMETs.toFixed(1)} />}
        {hrStats && <Chip label="HR Avg" value={`${Math.round(hrStats.avg)}`} unit="bpm" color={COLORS.red} />}
        {hrStats && <Chip label="HR Max" value={`${Math.round(hrStats.max)}`} unit="bpm" color={COLORS.red} sub={`${Math.round(hrStats.max / maxHR * 100)}% maxHR`} />}
        {apple?.weather && <Chip label="Weather" value={`${apple.weather}`} />}
        {apple?.elevationAscended != null && apple.elevationAscended > 0 && <Chip label="Elevation" value={`${Math.round(apple.elevationAscended)}`} unit="m" />}
      </div>

      {/* HR mini-chart with zone bands */}
      {hrSamples.length > 1 && (
        <div className="bg-zinc-950/50 rounded-lg p-3">
          <div className="flex items-center justify-between mb-1">
            <span className="text-[11px] uppercase tracking-wider text-zinc-500">Heart Rate</span>
            {zoneMinutes && (
              <div className="flex items-center gap-1.5 text-[10px] tabular-nums">
                {zoneMinutes.map((m, i) => m > 0.1 && (
                  <span key={i} className="inline-flex items-center gap-1">
                    <span className="w-1.5 h-1.5 rounded-full" style={{ background: ZONE_COLORS[i] }} />
                    <span className="text-zinc-400">Z{i + 1}</span>
                    <span className="text-zinc-500">{m.toFixed(0)}m</span>
                  </span>
                ))}
              </div>
            )}
          </div>
          <div className="h-24">
            <ResponsiveContainer width="100%" height="100%" minWidth={0} debounce={1}>
              <LineChart data={hrSamples} margin={{ top: 4, right: 4, bottom: 0, left: -20 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={ct.grid} vertical={false} />
                <XAxis dataKey="min" type="number" stroke={ct.tick} fontSize={10} tickLine={false} axisLine={false} tickFormatter={(v) => `${Math.round(v)}m`} />
                <YAxis stroke={ct.tick} fontSize={10} tickLine={false} axisLine={false} domain={['dataMin - 5', 'dataMax + 5']} />
                <Tooltip content={<ChartTooltip formatter={(v) => [`${Math.round(v)} bpm`, 'HR']} />} />
                {[0.6, 0.7, 0.8, 0.9].map(p => (
                  <ReferenceLine key={p} y={maxHR * p} stroke={ct.grid} strokeDasharray="2 4" />
                ))}
                <Line type="monotone" dataKey="bpm" stroke={COLORS.red} strokeWidth={1.5} dot={false} isAnimationActive={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {/* Muscle-group distribution for this session */}
      {muscleTotal > 0 && (
        <div>
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-[11px] uppercase tracking-wider text-zinc-500">Volume by Muscle Group</span>
            <span className="text-[10px] text-zinc-500 tabular-nums">{fmt(muscleTotal)} kg</span>
          </div>
          <div className="flex h-2 rounded-full overflow-hidden bg-zinc-950">
            {muscleVolume.map(([group, vol]) => (
              <div
                key={group}
                style={{ width: `${(vol / muscleTotal) * 100}%`, background: muscleColor(group) }}
                title={`${group}: ${Math.round(vol)} kg`}
              />
            ))}
          </div>
          <div className="flex flex-wrap gap-x-3 gap-y-0.5 mt-1.5 text-[10px] tabular-nums">
            {muscleVolume.map(([group, vol]) => (
              <span key={group} className="inline-flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full" style={{ background: muscleColor(group) }} />
                <span className="text-zinc-400 capitalize">{group}</span>
                <span className="text-zinc-500">{Math.round((vol / muscleTotal) * 100)}%</span>
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Per-exercise detail */}
      {h.exercises.map(ex => {
        const top = bestSet(ex.sets)
        const e1 = bestE1RM(ex.sets)
        const history = exerciseHistory.get(ex.title) ?? []
        const idx = history.findIndex(x => x.sessionId === h.id)
        const priorBest = idx > 0 ? Math.max(...history.slice(0, idx).map(x => x.e1rm)) : 0
        const isPR = idx >= 0 && e1 > 0 && e1 > priorBest && history.length > 1
        const lastE1 = idx > 0 ? history[idx - 1].e1rm : 0
        const delta = idx > 0 && lastE1 > 0 ? e1 - lastE1 : null

        return (
          <div key={`${ex.index}-${ex.templateId}`} className="bg-zinc-950/30 rounded-lg p-3">
            <div className="flex items-center justify-between gap-2 mb-2 flex-wrap">
              <div className="flex items-center gap-2 min-w-0">
                <span className="text-[13px] font-medium text-zinc-100 truncate">{ex.title}</span>
                {ex.primaryMuscleGroup && (
                  <span
                    className="text-[9px] uppercase tracking-wider px-1.5 py-0.5 rounded"
                    style={{ color: muscleColor(ex.primaryMuscleGroup), background: `${muscleColor(ex.primaryMuscleGroup)}1f` }}
                  >
                    {ex.primaryMuscleGroup}
                  </span>
                )}
                {isPR && (
                  <span className="text-[9px] uppercase tracking-wider px-1.5 py-0.5 rounded text-yellow-300 bg-yellow-500/15 ring-1 ring-yellow-500/30">
                    🥇 PR
                  </span>
                )}
              </div>
              <div className="text-[11px] text-zinc-500 tabular-nums shrink-0 flex items-center gap-3">
                {top && <span>top: <span className="text-zinc-300">{top.weight} kg × {top.reps}</span></span>}
                {e1 > 0 && (
                  <span>
                    e1RM <span className="text-zinc-300">{e1.toFixed(1)}</span>
                    {delta !== null && Math.abs(delta) >= 0.05 && (
                      <span className={delta > 0 ? 'text-green-400 ml-1' : 'text-red-400 ml-1'}>
                        {delta > 0 ? '+' : ''}{delta.toFixed(1)}
                      </span>
                    )}
                  </span>
                )}
                <span>vol <span className="text-zinc-300">{Math.round(ex.volumeKg)}</span> kg</span>
              </div>
            </div>
            <div className="grid grid-cols-[40px_60px_60px_60px_60px] gap-x-3 gap-y-1 text-[11px] tabular-nums">
              <div className="text-zinc-600 uppercase tracking-wider text-[10px]">Set</div>
              <div className="text-zinc-600 uppercase tracking-wider text-[10px]">Type</div>
              <div className="text-zinc-600 uppercase tracking-wider text-[10px]">Weight</div>
              <div className="text-zinc-600 uppercase tracking-wider text-[10px]">Reps</div>
              <div className="text-zinc-600 uppercase tracking-wider text-[10px]">RPE</div>
              {ex.sets.map(s => <SetRow key={s.index} set={s} />)}
            </div>
            {ex.notes && <div className="text-[11px] text-zinc-500 italic mt-2">{ex.notes}</div>}
          </div>
        )
      })}
    </div>
  )
}

function Chip({ label, value, unit, sub, color }: { label: string; value: string; unit?: string; sub?: string; color?: string }) {
  return (
    <div className="bg-zinc-950/40 rounded-lg px-3 py-2">
      <div className="text-[10px] uppercase tracking-wider text-zinc-500 mb-0.5">{label}</div>
      <div className="text-[15px] font-semibold tabular-nums leading-tight">
        <span style={{ color }}>{value}</span>
        {unit && <span className="text-[11px] text-zinc-500 ml-1 font-normal">{unit}</span>}
      </div>
      {sub && <div className="text-[10px] text-zinc-600 mt-0.5">{sub}</div>}
    </div>
  )
}

function SetRow({ set }: { set: { index: number; type: string; weightKg: number | null; reps: number | null; rpe: number | null } }) {
  const typeColor =
    set.type === 'warmup' ? 'text-amber-400/80' :
    set.type === 'failure' ? 'text-red-400/80' :
    set.type === 'dropset' ? 'text-purple-400/80' :
    'text-zinc-500'
  const typeLabel =
    set.type === 'warmup' ? 'W' :
    set.type === 'failure' ? 'F' :
    set.type === 'dropset' ? 'D' :
    '·'
  return (
    <>
      <div className="text-zinc-500">{set.index + 1}</div>
      <div className={typeColor}>{typeLabel}</div>
      <div className="text-zinc-200">{set.weightKg != null ? `${set.weightKg}` : '—'}</div>
      <div className="text-zinc-200">{set.reps != null ? set.reps : '—'}</div>
      <div className="text-zinc-400">{set.rpe != null ? set.rpe : '—'}</div>
    </>
  )
}

function Stat({ label, value, unit, color }: { label: string; value: string; unit?: string; color?: string }) {
  return (
    <div className="bg-zinc-900 rounded-xl p-4">
      <div className="text-[11px] font-medium tracking-wider uppercase text-zinc-500 mb-1.5">{label}</div>
      <div className="text-[26px] font-semibold tracking-tight tabular-nums leading-none">
        <span style={{ color }}>{value}</span>
        {unit && <span className="text-[13px] text-zinc-500 ml-1 font-normal">{unit}</span>}
      </div>
    </div>
  )
}
