import { useMemo, useState, useEffect, useCallback, lazy, Suspense, type ReactNode } from 'react'
import {
  XAxis, YAxis, Tooltip,
  CartesianGrid, Area, AreaChart, ReferenceLine,
} from 'recharts'
import type { HealthData, DailyMetrics } from './types'
import {
  LayoutDashboard, CalendarDays, CalendarRange, Heart, Activity,
  Scale, Moon, Sun, Headphones, GitCompareArrows, Dumbbell, Route, Map,
  Gauge, Droplets,
  Footprints, Zap, TrendingUp, Wind, MapPin, Waves,
} from 'lucide-react'
import { groupedAverage, workoutSummary, monthlyWorkouts } from './analysis'
import { COLORS, chartMargin, StatBox, ChartCard, SectionHeader, SubsectionHeader, TabHeader, ChartTooltip, shortDateCompact, fmt, humanizeWorkoutType, useChartTheme, TabSkeleton, EmptyState } from './ui'
import TopNav, { type NavGroup } from './components/TopNav'

const TrainingViewer = lazy(() => import('./TrainingViewer'))
const SleepAnalysis = lazy(() => import('./SleepAnalysis'))
const Correlations = lazy(() => import('./Correlations'))
const RouteHeatmap = lazy(() => import('./RouteHeatmap'))
const BodyComposition = lazy(() => import('./BodyComposition'))
const Cardio = lazy(() => import('./Cardio'))
const AudioExposure = lazy(() => import('./AudioExposure'))
const Daylight = lazy(() => import('./Daylight'))
const RouteComparison = lazy(() => import('./RouteComparison'))
const YearInReview = lazy(() => import('./YearInReview'))
const CalendarHeatmap = lazy(() => import('./CalendarHeatmap'))
const HealthScoreView = lazy(() => import('./HealthScoreView'))
const Trends = lazy(() => import('./Trends'))
const AIInsights = lazy(() => import('./AIInsights'))
const MenstrualCycle = lazy(() => import('./MenstrualCycle'))
const GarminTraining = lazy(() => import('./GarminTraining'))
const Mobility = lazy(() => import('./Mobility'))
const RunningDynamics = lazy(() => import('./RunningDynamics'))
const TrainingLoad = lazy(() => import('./TrainingLoad'))

type TimeRange = '1w' | '3m' | '6m' | '1y' | 'all'
type Granularity = 'daily' | 'weekly' | 'monthly'
type Tab = 'overview' | 'score' | 'yearly' | 'calendar' | 'cardio' | 'body' | 'sleep' | 'menstrual' | 'daylight' | 'audio' | 'correlations' | 'trainings' | 'compare' | 'heatmap' | 'garmin-training' | 'mobility' | 'running' | 'load'

const Loading = <TabSkeleton />

const VALID_TABS = new Set<Tab>(['overview', 'score', 'yearly', 'calendar', 'cardio', 'body', 'sleep', 'menstrual', 'daylight', 'audio', 'correlations', 'trainings', 'compare', 'heatmap', 'garmin-training', 'mobility', 'running', 'load'])
const VALID_RANGES = new Set<TimeRange>(['1w', '3m', '6m', '1y', 'all'])
const VALID_GRANULARITIES = new Set<Granularity>(['daily', 'weekly', 'monthly'])

function parseHash(): { tab?: Tab; range?: TimeRange; granularity?: Granularity } {
  const hash = window.location.hash.slice(1)
  if (!hash) return {}
  const params = new URLSearchParams(hash)
  const t = params.get('tab') as Tab | null
  const r = params.get('range') as TimeRange | null
  const g = params.get('granularity') as Granularity | null
  return {
    tab: t && VALID_TABS.has(t) ? t : undefined,
    range: r && VALID_RANGES.has(r) ? r : undefined,
    granularity: g && VALID_GRANULARITIES.has(g) ? g : undefined,
  }
}

function applyThemeClass(t: 'light' | 'dark') {
  document.documentElement.classList.toggle('dark', t === 'dark')
  document.documentElement.classList.toggle('light', t === 'light')
}

function useTheme() {
  const [theme, setThemeState] = useState<'light' | 'dark'>(() => {
    const stored = localStorage.getItem('health-dashboard-theme')
    if (stored === 'light' || stored === 'dark') return stored
    return 'dark'
  })

  const setTheme = useCallback((t: 'light' | 'dark') => {
    // Apply class synchronously so chart theme hooks read the new value on the next render
    applyThemeClass(t)
    localStorage.setItem('health-dashboard-theme', t)
    setThemeState(t)
  }, [])

  useEffect(() => {
    applyThemeClass(theme)
  }, [theme])

  return [theme, setTheme] as const
}

export default function Dashboard({ data, onReset }: { data: HealthData; onReset: () => void }) {
  const initial = parseHash()
  const [range, setRange] = useState<TimeRange>(initial.range ?? 'all')
  const [granularity, setGranularity] = useState<Granularity>(initial.granularity ?? 'weekly')
  const [tab, setTab] = useState<Tab>(initial.tab ?? 'overview')
  const [theme, setTheme] = useTheme()
  const ct = useChartTheme()

  // Sync state → URL hash
  useEffect(() => {
    const params = new URLSearchParams()
    if (tab !== 'overview') params.set('tab', tab)
    if (range !== 'all') params.set('range', range)
    if (granularity !== 'weekly') params.set('granularity', granularity)
    const hash = params.toString()
    const newUrl = hash ? `#${hash}` : window.location.pathname
    window.history.replaceState(null, '', newUrl)
  }, [tab, range, granularity])

  // Listen for browser back/forward
  useEffect(() => {
    const onHashChange = () => {
      const parsed = parseHash()
      if (parsed.tab) setTab(parsed.tab)
      if (parsed.range) setRange(parsed.range)
      if (parsed.granularity) setGranularity(parsed.granularity)
    }
    window.addEventListener('hashchange', onHashChange)
    return () => window.removeEventListener('hashchange', onHashChange)
  }, [])

  // Idle-prefetch likely-next tab chunks so cold switches feel instant.
  useEffect(() => {
    const prefetch = () => {
      const loaders: Record<string, () => Promise<unknown>> = {
        score: () => import('./HealthScoreView'),
        cardio: () => import('./Cardio'),
        sleep: () => import('./SleepAnalysis'),
        body: () => import('./BodyComposition'),
        calendar: () => import('./CalendarHeatmap'),
        trainings: () => import('./TrainingViewer'),
      }
      // Map the current tab to its most likely neighbors.
      const neighbors: Record<string, string[]> = {
        overview: ['score', 'cardio'],
        score: ['cardio', 'sleep'],
        cardio: ['body', 'sleep'],
        body: ['cardio', 'sleep'],
        sleep: ['cardio', 'body'],
      }
      const targets = neighbors[tab] ?? ['score', 'cardio']
      for (const key of targets) loaders[key]?.()
    }
    const ric = (window as unknown as { requestIdleCallback?: (cb: () => void, opts?: { timeout?: number }) => number }).requestIdleCallback
    if (ric) ric(prefetch, { timeout: 2000 })
    else setTimeout(prefetch, 500)
  }, [tab])
  const hasGpx = data.gpxFiles.size > 0
  const hasSleep = data.sleepRecords.length > 0
  const hasBody = data.bodyRecords.length > 0
  const hasCardio = data.cardioRecords.length > 0
  const hasAudio = data.dailyAudio.length > 0
  const hasDaylight = data.dailyDaylight.length > 0
  const hasMenstrual = data.menstrualRecords.length > 0
  const hasMobility = data.dailyMobility.length > 0
  const hasRunning = data.runningDynamics.length > 0
  const hasGarmin = data.sourceMode === 'garmin' && !!data.garminMetrics

  const allMetrics = useMemo(() => {
    return Array.from(data.dailyMetrics.values()).sort((a, b) => a.date.localeCompare(b.date))
  }, [data])

  const cutoffDate = useMemo(() => {
    if (range === 'all') return ''
    const now = new Date()
    if (range === '1w') {
      const cutoff = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 7)
      return cutoff.toISOString().substring(0, 10)
    }
    const months = range === '3m' ? 3 : range === '6m' ? 6 : 12
    const cutoff = new Date(now.getFullYear(), now.getMonth() - months, now.getDate())
    return cutoff.toISOString().substring(0, 10)
  }, [range])

  const filteredMetrics = useMemo(() => {
    if (!cutoffDate) return allMetrics
    return allMetrics.filter(m => m.date >= cutoffDate)
  }, [allMetrics, cutoffDate])

  const stepsData = useMemo(() => groupedAverage(filteredMetrics, 'steps', granularity), [filteredMetrics, granularity])
  const hrData = useMemo(() => groupedAverage(filteredMetrics, 'restingHeartRate', granularity), [filteredMetrics, granularity])
  const hrvData = useMemo(() => groupedAverage(filteredMetrics, 'hrv', granularity), [filteredMetrics, granularity])
  const sleepData = useMemo(() => groupedAverage(filteredMetrics, 'sleepHours', granularity), [filteredMetrics, granularity])
  const distanceData = useMemo(() => groupedAverage(filteredMetrics, 'distance', granularity), [filteredMetrics, granularity])
  const weightData = useMemo(() => groupedAverage(filteredMetrics, 'weight', granularity), [filteredMetrics, granularity])
  const vo2Data = useMemo(() => groupedAverage(filteredMetrics, 'vo2max', granularity), [filteredMetrics, granularity])
  const workoutsByMonth = useMemo(() => monthlyWorkouts(data.workouts), [data.workouts])

  const avgOf = (data: { value: number }[]): number =>
    data.length === 0 ? 0 : data.reduce((s, d) => s + d.value, 0) / data.length
  const topWorkouts = useMemo(() => workoutSummary(data.workouts).slice(0, 8), [data.workouts])

  // Summary stats (last 30 days)
  const recent30 = allMetrics.slice(-30)
  const avgSteps = avgMetric(recent30, 'steps')
  const avgSleep = avgMetric(recent30, 'sleepHours')
  const avgHR = avgMetric(recent30, 'restingHeartRate')
  const avgHRV = avgMetric(recent30, 'hrv')
  const latestWeight = findLatest(allMetrics, 'weight')
  const latestVO2 = findLatest(allMetrics, 'vo2max')
  const latestSteps = findLatest(allMetrics, 'steps')
  const latestSleep = findLatest(allMetrics, 'sleepHours')
  const latestHR = findLatest(allMetrics, 'restingHeartRate')
  const latestHRV = findLatest(allMetrics, 'hrv')
  const latestDistance = findLatest(allMetrics, 'distance')
  const totalWorkouts = data.workouts.length

  // Spark data for overview stat boxes
  const sparkFor = (key: keyof DailyMetrics) => recent30.map(m => m[key] as number).filter(v => v !== null && v > 0)

  const tabs: { key: Tab; label: string; icon: ReactNode; show: boolean; group: number }[] = [
    // 1 — Dashboard: current state
    { key: 'overview', label: 'Overview', icon: <LayoutDashboard size={16} />, show: true, group: 1 },
    { key: 'score', label: 'Score', icon: <Gauge size={16} />, show: true, group: 1 },
    // 2 — Health: physiological metrics
    { key: 'cardio', label: 'Cardio', icon: <Heart size={16} />, show: hasCardio, group: 2 },
    { key: 'body', label: 'Body', icon: <Scale size={16} />, show: hasBody, group: 2 },
    { key: 'sleep', label: 'Sleep', icon: <Moon size={16} />, show: hasSleep, group: 2 },
    { key: 'menstrual', label: 'Cycle', icon: <Droplets size={16} />, show: hasMenstrual || data.profile.sex === 'HKBiologicalSexFemale', group: 2 },
    { key: 'daylight', label: 'Daylight', icon: <Sun size={16} />, show: hasDaylight, group: 2 },
    { key: 'audio', label: 'Audio', icon: <Headphones size={16} />, show: hasAudio, group: 2 },
    // 3 — Fitness: performance & training state
    { key: 'mobility', label: 'Mobility', icon: <Footprints size={16} />, show: hasMobility, group: 3 },
    { key: 'running', label: 'Running', icon: <Zap size={16} />, show: hasRunning, group: 3 },
    { key: 'garmin-training', label: 'Training', icon: <Activity size={16} />, show: hasGarmin, group: 3 },
    { key: 'load', label: 'Training Load', icon: <TrendingUp size={16} />, show: data.workouts.length >= 7, group: 3 },
    // 4 — Activities: events & sessions
    { key: 'calendar', label: 'Calendar', icon: <CalendarRange size={16} />, show: true, group: 4 },
    { key: 'trainings', label: 'Trainings', icon: <Dumbbell size={16} />, show: data.workouts.length > 0, group: 4 },
    { key: 'compare', label: 'Compare', icon: <Route size={16} />, show: hasGpx, group: 4 },
    { key: 'heatmap', label: 'Heatmap', icon: <Map size={16} />, show: hasGpx, group: 4 },
    // 5 — Trends & Analysis: deeper insight
    { key: 'correlations', label: 'Correlations', icon: <GitCompareArrows size={16} />, show: true, group: 5 },
    { key: 'yearly', label: 'Yearly', icon: <CalendarDays size={16} />, show: true, group: 5 },
  ]

  const tabByKey = (key: Tab) => tabs.find(t => t.key === key)
  const subItem = (key: Tab) => {
    const t = tabByKey(key)!
    return { key: t.key, label: t.label, icon: t.icon, show: t.show }
  }
  const navGroups: NavGroup[] = [
    { key: 'overview', label: 'Overview', tabs: [subItem('overview')] },
    { key: 'score', label: 'Health Score', tabs: [subItem('score')] },
    {
      key: 'health',
      label: 'Health',
      tabs: [subItem('cardio'), subItem('body'), subItem('sleep'), subItem('menstrual'), subItem('daylight'), subItem('audio')],
    },
    {
      key: 'fitness',
      label: 'Fitness Activities',
      tabs: [subItem('mobility'), subItem('running'), subItem('garmin-training'), subItem('load'), subItem('calendar'), subItem('trainings'), subItem('compare'), subItem('heatmap')],
    },
    { key: 'analysis', label: 'Analysis', tabs: [subItem('correlations'), subItem('yearly')] },
  ]

  const showControls = tab === 'overview' || tab === 'score' || tab === 'cardio' || tab === 'body' || tab === 'sleep' || tab === 'menstrual' || tab === 'daylight' || tab === 'audio' || tab === 'calendar' || tab === 'garmin-training' || tab === 'mobility' || tab === 'running' || tab === 'load'

  const [settingsOpen, setSettingsOpen] = useState(false)

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100">
      <TopNav
        groups={navGroups}
        currentTab={tab}
        onTabChange={(key) => setTab(key as Tab)}
        theme={theme}
        onThemeToggle={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
        onReset={onReset}
        onSettings={showControls ? () => setSettingsOpen(true) : undefined}
      />

      <SettingsModal
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        granularity={granularity}
        onGranularityChange={setGranularity}
        range={range}
        onRangeChange={(r) => {
          setRange(r)
          if (r === '1w') setGranularity('daily')
          else if (r === '3m') setGranularity('daily')
          else if (r === '6m') setGranularity('weekly')
          else if (r === '1y') setGranularity('weekly')
          else setGranularity('weekly')
        }}
      />

      {/* Main content — top padding for fixed top bar */}
      <div className="min-w-0 pt-12">
      <main className="px-4 md:px-6 py-6 space-y-6">
        {tab === 'score' && (
          <Suspense fallback={Loading}>
            <HealthScoreView data={data} cutoffDate={cutoffDate} />
          </Suspense>
        )}

        {tab === 'yearly' && (
          <Suspense fallback={Loading}>
            <YearInReview metrics={allMetrics} workouts={data.workouts} />
          </Suspense>
        )}

        {tab === 'calendar' && (
          <Suspense fallback={Loading}>
            <CalendarHeatmap metrics={allMetrics} granularity={granularity} />
          </Suspense>
        )}

        {tab === 'cardio' && (hasCardio ? (
          <Suspense fallback={Loading}>
            <Cardio cardioRecords={data.cardioRecords} dailyHR={data.dailyHR} metrics={allMetrics} dob={data.profile.dob} cutoffDate={cutoffDate} granularity={granularity} />
          </Suspense>
        ) : (
          <EmptyState icon={<Heart size={28} />} title="No cardio data" hint="Your import doesn't contain heart-rate, VO2 max, or other cardio records. Re-export from Apple Health to include them." />
        ))}


        {tab === 'body' && (hasBody ? (
          <Suspense fallback={Loading}>
            <BodyComposition bodyRecords={data.bodyRecords} cutoffDate={cutoffDate} granularity={granularity} />
          </Suspense>
        ) : (
          <EmptyState icon={<Scale size={28} />} title="No body composition data" hint="No weight, body fat, or BMI entries were found in this import." />
        ))}

        {tab === 'sleep' && (
          <Suspense fallback={Loading}>
            <SleepAnalysis sleepRecords={data.sleepRecords} wristTempRecords={data.wristTempRecords} dailyBreathing={data.dailyBreathing} cutoffDate={cutoffDate} granularity={granularity} />
          </Suspense>
        )}

        {tab === 'menstrual' && (
          <Suspense fallback={Loading}>
            <MenstrualCycle menstrualRecords={data.menstrualRecords} wristTempRecords={data.wristTempRecords} cutoffDate={cutoffDate} />
          </Suspense>
        )}

        {tab === 'daylight' && (hasDaylight ? (
          <Suspense fallback={Loading}>
            <Daylight dailyDaylight={data.dailyDaylight} cutoffDate={cutoffDate} granularity={granularity} />
          </Suspense>
        ) : (
          <EmptyState icon={<Sun size={28} />} title="No daylight data" hint="Time-in-daylight is recorded by Apple Watch Series 6 and later. No entries were found in this import." />
        ))}

        {tab === 'audio' && (hasAudio ? (
          <Suspense fallback={Loading}>
            <AudioExposure dailyAudio={data.dailyAudio} cutoffDate={cutoffDate} granularity={granularity} />
          </Suspense>
        ) : (
          <EmptyState icon={<Headphones size={28} />} title="No audio exposure data" hint="Headphone and environmental audio levels weren't found in this import." />
        ))}

        {tab === 'mobility' && (hasMobility ? (
          <Suspense fallback={Loading}>
            <Mobility dailyMobility={data.dailyMobility} cutoffDate={cutoffDate} granularity={granularity} />
          </Suspense>
        ) : (
          <EmptyState icon={<Footprints size={28} />} title="No mobility data" hint="Walking speed, step length, and other gait metrics weren't found in this import." />
        ))}

        {tab === 'running' && (hasRunning ? (
          <Suspense fallback={Loading}>
            <RunningDynamics runningDynamics={data.runningDynamics} cutoffDate={cutoffDate} granularity={granularity} />
          </Suspense>
        ) : (
          <EmptyState icon={<Zap size={28} />} title="No running dynamics" hint="Running power, stride length, and similar metrics require a compatible Apple Watch. Nothing was found in this import." />
        ))}

        {tab === 'load' && (data.workouts.length >= 7 ? (
          <Suspense fallback={Loading}>
            <TrainingLoad workouts={data.workouts} cutoffDate={cutoffDate} />
          </Suspense>
        ) : (
          <EmptyState icon={<TrendingUp size={28} />} title="Not enough workout data" hint="Training load needs at least 7 workouts to compute acute-to-chronic ratios. Log a few more and try again." />
        ))}

        {tab === 'correlations' && (
          <Suspense fallback={Loading}>
            <Correlations metrics={allMetrics} sleepRecords={data.sleepRecords} caffeineRecords={data.caffeineRecords} dailyBreathing={data.dailyBreathing} cardioRecords={data.cardioRecords} dailyDaylight={data.dailyDaylight} />
          </Suspense>
        )}

        {tab === 'trainings' && (data.workouts.length > 0 ? (
          <div className="space-y-6">
            <TabHeader title="Trainings" description="Workout type breakdown plus per-session detail with GPS routes, heart rate, pace, and elevation." />
            {topWorkouts.length > 0 && (
              <div className="space-y-3">
                <SectionHeader>Types</SectionHeader>
                <div className="bg-zinc-900 rounded-xl border border-zinc-800 p-4">
                  <h3 className="text-sm font-medium text-zinc-300 mb-3">Workout Types ({totalWorkouts} total)</h3>
                  <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-8 gap-3">
                    {topWorkouts.map(w => (
                      <div key={w.type} className="bg-zinc-800/50 rounded-lg p-3 min-w-0">
                        <div className="text-sm font-medium text-zinc-200 truncate" title={w.type}>{humanizeWorkoutType(w.type)}</div>
                        <div className="text-lg font-semibold text-zinc-100 mt-1">{w.count}<span className="text-xs text-zinc-500 ml-1">sessions</span></div>
                        <div className="text-xs text-zinc-500 mt-0.5 truncate">{Math.round(w.totalMinutes / 60)}h · {fmt(w.totalCalories)} kcal</div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}
            <div className="space-y-3">
              <SectionHeader>Detail</SectionHeader>
              {hasGpx ? (
                <Suspense fallback={Loading}>
                  <TrainingViewer workouts={data.workouts} gpxFiles={data.gpxFiles} hrTimeline={data.hrTimeline} dob={data.profile.dob} />
                </Suspense>
              ) : (
                <div className="bg-zinc-900 rounded-xl border border-zinc-800 p-6 text-center text-xs text-zinc-500">
                  No GPX routes in this import. Drop a folder with <code className="text-zinc-400">workout-routes/*.gpx</code> to see route maps.
                </div>
              )}
            </div>
          </div>
        ) : (
          <EmptyState icon={<Dumbbell size={28} />} title="No workouts found" hint="No workout records were detected in this import." />
        ))}

        {tab === 'compare' && (hasGpx ? (
          <Suspense fallback={Loading}>
            <RouteComparison gpxFiles={data.gpxFiles} />
          </Suspense>
        ) : (
          <EmptyState icon={<Route size={28} />} title="No routes to compare" hint="Comparison needs at least two GPX routes from your Apple Health export." />
        ))}

        {tab === 'heatmap' && (hasGpx ? (
          <Suspense fallback={Loading}>
            <RouteHeatmap gpxFiles={data.gpxFiles} />
          </Suspense>
        ) : (
          <EmptyState icon={<Map size={28} />} title="No routes for a heatmap" hint="The heatmap aggregates your GPX routes, none of which were found in this import." />
        ))}

        {tab === 'garmin-training' && (hasGarmin && data.garminMetrics ? (
          <Suspense fallback={Loading}>
            <GarminTraining garminMetrics={data.garminMetrics} granularity={granularity} dateRange={[cutoffDate || '2000-01-01', '2099-12-31']} />
          </Suspense>
        ) : (
          <EmptyState icon={<Activity size={28} />} title="No Garmin training data" hint="Switch the source to Garmin on the upload screen and select your Garmin export folder to see training metrics." />
        ))}

        {tab === 'overview' && <>
        {/* Key Metrics */}
        <TabHeader title="Overview" description="Your health at a glance — key metrics and trend movement across multiple windows." />
        <SubsectionHeader title="At a Glance" description="30-day averages and latest readings across your key health metrics." />
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-8 gap-3">
          <StatBox label="Steps" icon={<Footprints size={14} />} value={fmt(avgSteps)} unit="/day" sub="30d avg" latest={latestSteps !== null ? fmt(latestSteps, 0) : undefined} color={COLORS.blue} sparkData={sparkFor('steps')} />
          <StatBox label="Sleep" icon={<Moon size={14} />} value={fmt(avgSleep, 1)} unit="hrs" sub="30d avg" latest={latestSleep !== null ? `${fmt(latestSleep, 1)}h` : undefined} color={COLORS.cyan} sparkData={sparkFor('sleepHours')} />
          <StatBox label="Resting HR" icon={<Heart size={14} />} value={fmt(avgHR, 0)} unit="bpm" sub="30d avg" latest={latestHR !== null ? `${fmt(latestHR, 0)}` : undefined} color={COLORS.red} sparkData={sparkFor('restingHeartRate')} />
          <StatBox label="HRV" icon={<Waves size={14} />} value={fmt(avgHRV, 0)} unit="ms" sub="30d avg" latest={latestHRV !== null ? `${fmt(latestHRV, 0)}` : undefined} color={COLORS.purple} sparkData={sparkFor('hrv')} />
          <StatBox label="Weight" icon={<Scale size={14} />} value={fmt(latestWeight, 1)} unit="kg" sub="Latest" color={COLORS.orange} sparkData={sparkFor('weight')} />
          <StatBox label="VO2 Max" icon={<Wind size={14} />} value={fmt(latestVO2, 1)} unit="mL/kg/min" sub="Latest" color={COLORS.green} sparkData={sparkFor('vo2max')} />
          <StatBox label="Distance" icon={<MapPin size={14} />} value={fmt(avgMetric(recent30, 'distance'), 1)} unit="km/day" sub="30d avg" latest={latestDistance !== null ? `${fmt(latestDistance, 1)}` : undefined} color={COLORS.green} sparkData={sparkFor('distance')} />
          <StatBox label="Workouts" icon={<Dumbbell size={14} />} value={`${totalWorkouts}`} unit="total" color={COLORS.zinc} sub={`${workoutsByMonth.length > 0 ? workoutsByMonth[workoutsByMonth.length - 1]?.count || 0 : 0} this month`} />
        </div>

        {/* Key charts */}
        <SubsectionHeader title="Charts" description="Trends over time for the metrics that matter most." />
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3">
            {stepsData.length > 0 && (
              <ChartCard title="Steps" chartData={stepsData} icon={<Footprints size={14} />} color={COLORS.blue}>
                <AreaChart margin={chartMargin} data={stepsData}>
                  <defs>
                    <linearGradient id="stepsGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor={COLORS.blue} stopOpacity={0.3} />
                      <stop offset="95%" stopColor={COLORS.blue} stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke={ct.grid} />
                  <XAxis dataKey="week" tick={{ fontSize: 10, fill: ct.tick }} tickFormatter={shortDateCompact} interval="preserveStartEnd" minTickGap={40} />
                  <YAxis tick={{ fontSize: 10, fill: ct.tick }} />
                  <Tooltip content={<ChartTooltip />} />
                  <ReferenceLine y={avgOf(stepsData)} stroke={COLORS.blue} strokeDasharray="4 4" strokeOpacity={0.5} label={{ value: 'avg', position: 'right', fill: ct.tick, fontSize: 9 }} />
                  <Area type="monotone" dataKey="value" stroke={COLORS.blue} fill="url(#stepsGrad)" strokeWidth={1.5} dot={false} />
                </AreaChart>
              </ChartCard>
            )}

            {sleepData.length > 0 && (
              <ChartCard title="Sleep" chartData={sleepData} icon={<Moon size={14} />} color={COLORS.cyan}>
                <AreaChart margin={chartMargin} data={sleepData}>
                  <defs>
                    <linearGradient id="sleepGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor={COLORS.cyan} stopOpacity={0.3} />
                      <stop offset="95%" stopColor={COLORS.cyan} stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke={ct.grid} />
                  <XAxis dataKey="week" tick={{ fontSize: 10, fill: ct.tick }} tickFormatter={shortDateCompact} interval="preserveStartEnd" minTickGap={40} />
                  <YAxis domain={['auto', 'auto']} tick={{ fontSize: 10, fill: ct.tick }} />
                  <Tooltip content={<ChartTooltip />} />
                  <ReferenceLine y={avgOf(sleepData)} stroke={COLORS.cyan} strokeDasharray="4 4" strokeOpacity={0.5} label={{ value: 'avg', position: 'right', fill: ct.tick, fontSize: 9 }} />
                  <Area type="monotone" dataKey="value" stroke={COLORS.cyan} fill="url(#sleepGrad)" strokeWidth={1.5} dot={false} />
                </AreaChart>
              </ChartCard>
            )}

            {hrData.length > 0 && (
              <ChartCard title="Resting Heart Rate" chartData={hrData} icon={<Heart size={14} />} color={COLORS.red}>
                <AreaChart margin={chartMargin} data={hrData}>
                  <defs>
                    <linearGradient id="hrGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor={COLORS.red} stopOpacity={0.3} />
                      <stop offset="95%" stopColor={COLORS.red} stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke={ct.grid} />
                  <XAxis dataKey="week" tick={{ fontSize: 10, fill: ct.tick }} tickFormatter={shortDateCompact} interval="preserveStartEnd" minTickGap={40} />
                  <YAxis domain={['auto', 'auto']} tick={{ fontSize: 10, fill: ct.tick }} />
                  <Tooltip content={<ChartTooltip />} />
                  <ReferenceLine y={avgOf(hrData)} stroke={COLORS.red} strokeDasharray="4 4" strokeOpacity={0.5} label={{ value: 'avg', position: 'right', fill: ct.tick, fontSize: 9 }} />
                  <Area type="monotone" dataKey="value" stroke={COLORS.red} fill="url(#hrGrad)" strokeWidth={1.5} dot={false} />
                </AreaChart>
              </ChartCard>
            )}

            {hrvData.length > 0 && (
              <ChartCard title="Heart Rate Variability" chartData={hrvData} icon={<Waves size={14} />} color={COLORS.purple}>
                <AreaChart margin={chartMargin} data={hrvData}>
                  <defs>
                    <linearGradient id="hrvGrad2" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor={COLORS.purple} stopOpacity={0.3} />
                      <stop offset="95%" stopColor={COLORS.purple} stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke={ct.grid} />
                  <XAxis dataKey="week" tick={{ fontSize: 10, fill: ct.tick }} tickFormatter={shortDateCompact} interval="preserveStartEnd" minTickGap={40} />
                  <YAxis domain={['auto', 'auto']} tick={{ fontSize: 10, fill: ct.tick }} />
                  <Tooltip content={<ChartTooltip />} />
                  <ReferenceLine y={avgOf(hrvData)} stroke={COLORS.purple} strokeDasharray="4 4" strokeOpacity={0.5} label={{ value: 'avg', position: 'right', fill: ct.tick, fontSize: 9 }} />
                  <Area type="monotone" dataKey="value" stroke={COLORS.purple} fill="url(#hrvGrad2)" strokeWidth={1.5} dot={false} />
                </AreaChart>
              </ChartCard>
            )}
        </div>

        {/* Secondary charts */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
          {distanceData.length > 0 && (
            <ChartCard title="Distance (km)" chartData={distanceData} icon={<MapPin size={14} />} color={COLORS.green}>
              <AreaChart margin={chartMargin} data={distanceData}>
                <defs>
                  <linearGradient id="distGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor={COLORS.green} stopOpacity={0.3} />
                    <stop offset="95%" stopColor={COLORS.green} stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke={ct.grid} />
                <XAxis dataKey="week" tick={{ fontSize: 10, fill: ct.tick }} tickFormatter={shortDateCompact} interval="preserveStartEnd" minTickGap={40} />
                <YAxis tick={{ fontSize: 10, fill: ct.tick }} />
                <Tooltip content={<ChartTooltip />} />
                <ReferenceLine y={avgOf(distanceData)} stroke={COLORS.green} strokeDasharray="4 4" strokeOpacity={0.5} label={{ value: 'avg', position: 'right', fill: ct.tick, fontSize: 9 }} />
                <Area type="monotone" dataKey="value" stroke={COLORS.green} fill="url(#distGrad)" strokeWidth={1.5} dot={false} />
              </AreaChart>
            </ChartCard>
          )}

          {weightData.length > 0 && (
            <ChartCard title="Weight (kg)" chartData={weightData} icon={<Scale size={14} />} color={COLORS.orange}>
              <AreaChart margin={chartMargin} data={weightData}>
                <defs>
                  <linearGradient id="weightGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor={COLORS.orange} stopOpacity={0.3} />
                    <stop offset="95%" stopColor={COLORS.orange} stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke={ct.grid} />
                <XAxis dataKey="week" tick={{ fontSize: 10, fill: ct.tick }} tickFormatter={shortDateCompact} interval="preserveStartEnd" minTickGap={40} />
                <YAxis domain={['auto', 'auto']} tick={{ fontSize: 10, fill: ct.tick }} />
                <Tooltip content={<ChartTooltip />} />
                <ReferenceLine y={avgOf(weightData)} stroke={COLORS.orange} strokeDasharray="4 4" strokeOpacity={0.5} label={{ value: 'avg', position: 'right', fill: ct.tick, fontSize: 9 }} />
                <Area type="monotone" dataKey="value" stroke={COLORS.orange} fill="url(#weightGrad)" strokeWidth={1.5} dot={false} />
              </AreaChart>
            </ChartCard>
          )}

          {vo2Data.length > 0 && (
            <ChartCard title="VO2 Max" chartData={vo2Data} icon={<Wind size={14} />} color={COLORS.green}>
              <AreaChart margin={chartMargin} data={vo2Data}>
                <defs>
                  <linearGradient id="vo2Grad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor={COLORS.green} stopOpacity={0.3} />
                    <stop offset="95%" stopColor={COLORS.green} stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke={ct.grid} />
                <XAxis dataKey="week" tick={{ fontSize: 10, fill: ct.tick }} tickFormatter={shortDateCompact} interval="preserveStartEnd" minTickGap={40} />
                <YAxis domain={['auto', 'auto']} tick={{ fontSize: 10, fill: ct.tick }} />
                <Tooltip content={<ChartTooltip />} />
                <ReferenceLine y={avgOf(vo2Data)} stroke={COLORS.green} strokeDasharray="4 4" strokeOpacity={0.5} label={{ value: 'avg', position: 'right', fill: ct.tick, fontSize: 9 }} />
                <Area type="monotone" dataKey="value" stroke={COLORS.green} fill="url(#vo2Grad)" strokeWidth={1.5} dot={false} />
              </AreaChart>
            </ChartCard>
          )}
        </div>

        {/* Trends + AI Insights inlined into Overview */}
        <Suspense fallback={Loading}>
          <Trends data={data} metrics={allMetrics} />
        </Suspense>
        <Suspense fallback={Loading}>
          <AIInsights data={data} metrics={allMetrics} />
        </Suspense>
        </>}

        <footer className="text-center text-zinc-600 text-xs py-8">
          All data processed locally in your browser. Nothing is sent to any server.
        </footer>
      </main>
      </div>
    </div>
  )
}

function avgMetric(metrics: DailyMetrics[], key: keyof DailyMetrics): number | null {
  const vals = metrics.map(m => m[key] as number | null).filter((v): v is number => v !== null && v > 0)
  return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null
}

function findLatest(metrics: DailyMetrics[], key: keyof DailyMetrics): number | null {
  for (let i = metrics.length - 1; i >= 0; i--) {
    const v = metrics[i][key]
    if (v !== null && v !== undefined && (v as number) > 0) return v as number
  }
  return null
}

function SettingsModal({
  open,
  onClose,
  granularity,
  onGranularityChange,
  range,
  onRangeChange,
}: {
  open: boolean
  onClose: () => void
  granularity: Granularity
  onGranularityChange: (g: Granularity) => void
  range: TimeRange
  onRangeChange: (r: TimeRange) => void
}) {
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) return null

  return (
    <div className="fixed inset-0 z-[140] flex items-start justify-center pt-24 px-4">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full max-w-md rounded-xl border border-zinc-800 bg-zinc-900 shadow-xl shadow-black/30 p-5 space-y-5">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-[15px] font-semibold text-zinc-100">Settings</h2>
            <p className="text-xs text-zinc-500 mt-0.5">Adjust how charts and stats are aggregated.</p>
          </div>
          <button
            onClick={onClose}
            aria-label="Close settings"
            className="w-8 h-8 flex items-center justify-center rounded-lg text-zinc-500 hover:text-zinc-200 hover:bg-zinc-800/60 transition-colors"
          >
            ×
          </button>
        </div>

        <div>
          <div className="text-[10px] font-medium tracking-wider uppercase text-zinc-500 mb-2">Granularity</div>
          <div className="flex bg-zinc-950 rounded-lg p-0.5 border border-zinc-800">
            {(['daily', 'weekly', 'monthly'] as Granularity[]).map(g => (
              <button
                key={g}
                onClick={() => onGranularityChange(g)}
                className={`flex-1 px-3 py-1.5 text-xs rounded-md transition-colors capitalize ${
                  granularity === g ? 'bg-green-500/15 text-green-400 ring-1 ring-green-500/25' : 'text-zinc-400 hover:text-zinc-200'
                }`}
              >
                {g}
              </button>
            ))}
          </div>
        </div>

        <div>
          <div className="text-[10px] font-medium tracking-wider uppercase text-zinc-500 mb-2">Time range</div>
          <div className="flex bg-zinc-950 rounded-lg p-0.5 border border-zinc-800">
            {(['1w', '3m', '6m', '1y', 'all'] as TimeRange[]).map(r => (
              <button
                key={r}
                onClick={() => onRangeChange(r)}
                className={`flex-1 px-3 py-1.5 text-xs rounded-md transition-colors ${
                  range === r ? 'bg-green-500/15 text-green-400 ring-1 ring-green-500/25' : 'text-zinc-400 hover:text-zinc-200'
                }`}
              >
                {r.toUpperCase()}
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
