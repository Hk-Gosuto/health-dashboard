import { useMemo } from 'react'
import type { HealthData, DailyMetrics } from './types'
import { computeMultiWindowTrends, type MultiWindowInput, type MultiWindowTrend, type MultiWindowRow } from './analysis'
import { COLORS, Sparkline, SubsectionHeader, fmt } from './ui'
import { ArrowUp, ArrowDown, Minus, Heart, Waves, Wind, Moon, Droplets, Scale, Footprints, Flame, MapPin, Dumbbell, Activity } from 'lucide-react'
import type { ReactNode } from 'react'

interface Props {
  data: HealthData
  metrics: DailyMetrics[]
}

const CATEGORY_ORDER: MultiWindowInput['category'][] = ['cardio', 'sleep', 'breathing', 'body', 'activity']
const CATEGORY_LABEL: Record<MultiWindowInput['category'], string> = {
  cardio: 'Cardio',
  sleep: 'Sleep',
  breathing: 'Breathing',
  body: 'Body',
  activity: 'Activity',
}

function buildInputs(data: HealthData, metrics: DailyMetrics[]): MultiWindowInput[] {
  const inputs: MultiWindowInput[] = []

  // --- Cardio ---
  inputs.push({
    metric: 'Resting Heart Rate', unit: 'bpm', higherIsGood: false, category: 'cardio',
    data: metrics.map(m => ({ date: m.date, value: m.restingHeartRate })),
  })
  inputs.push({
    metric: 'Heart Rate Variability', unit: 'ms', higherIsGood: true, category: 'cardio',
    data: metrics.map(m => ({ date: m.date, value: m.hrv })),
  })
  const vo2 = data.cardioRecords.filter(r => r.type === 'vo2max')
  if (vo2.length > 0) {
    inputs.push({
      metric: 'VO2 Max', unit: 'mL/kg/min', higherIsGood: true, category: 'cardio',
      data: vo2.map(r => ({ date: r.date, value: r.value })),
    })
  }
  const whr = data.cardioRecords.filter(r => r.type === 'walkingHR')
  if (whr.length > 0) {
    inputs.push({
      metric: 'Walking HR', unit: 'bpm', higherIsGood: false, category: 'cardio',
      data: whr.map(r => ({ date: r.date, value: r.value })),
    })
  }

  // --- Sleep ---
  inputs.push({
    metric: 'Sleep', unit: 'hrs', higherIsGood: true, category: 'sleep',
    data: metrics.map(m => ({ date: m.date, value: m.sleepHours })),
  })

  // --- Breathing ---
  const rr = data.dailyBreathing.filter(d => d.respiratoryRate !== null)
  if (rr.length > 0) {
    inputs.push({
      metric: 'Respiratory Rate', unit: 'br/min', higherIsGood: false, category: 'breathing',
      data: rr.map(d => ({ date: d.date, value: d.respiratoryRate })),
    })
  }
  const spo2 = data.dailyBreathing.filter(d => d.spo2 !== null)
  if (spo2.length > 0) {
    inputs.push({
      metric: 'Blood Oxygen', unit: '%', higherIsGood: true, category: 'breathing',
      data: spo2.map(d => ({ date: d.date, value: d.spo2 })),
    })
  }

  // --- Body ---
  const wt = data.bodyRecords.filter(r => r.weight !== null)
  if (wt.length > 0) {
    inputs.push({
      metric: 'Weight', unit: 'kg', higherIsGood: false, category: 'body',
      data: wt.map(r => ({ date: r.date, value: r.weight })),
    })
  }

  // --- Activity ---
  inputs.push({
    metric: 'Steps', unit: '/day', higherIsGood: true, category: 'activity',
    data: metrics.map(m => ({ date: m.date, value: m.steps })),
  })
  inputs.push({
    metric: 'Active Energy', unit: 'kcal', higherIsGood: true, category: 'activity',
    data: metrics.map(m => ({ date: m.date, value: m.activeEnergy })),
  })
  inputs.push({
    metric: 'Distance', unit: 'km', higherIsGood: true, category: 'activity',
    data: metrics.map(m => ({ date: m.date, value: m.distance })),
  })
  inputs.push({
    metric: 'Exercise', unit: 'min', higherIsGood: true, category: 'activity',
    data: metrics.map(m => ({ date: m.date, value: m.exerciseMinutes })),
  })

  return inputs
}

function rowColor(row: MultiWindowRow): string {
  if (row.direction === 'flat') return '#71717a'
  return row.positive ? COLORS.green : COLORS.red
}

function formatDelta(row: MultiWindowRow, unit: string): string {
  const sign = row.delta > 0 ? '+' : ''
  // Round to friendly precision per unit
  const decimals = unit === 'kcal' || unit === '/day' || unit === 'min' || unit === 'br/min' ? 0 : 1
  return `${sign}${fmt(row.delta, decimals)} ${unit}`
}

function TrendArrow({ direction }: { direction: MultiWindowRow['direction'] }) {
  if (direction === 'up') return <ArrowUp size={12} />
  if (direction === 'down') return <ArrowDown size={12} />
  return <Minus size={12} />
}

const METRIC_STYLE: Record<string, { icon: ReactNode; color: string }> = {
  'Resting Heart Rate': { icon: <Heart size={14} />, color: COLORS.red },
  'Heart Rate Variability': { icon: <Waves size={14} />, color: COLORS.purple },
  'VO2 Max': { icon: <Wind size={14} />, color: COLORS.green },
  'Walking HR': { icon: <Activity size={14} />, color: COLORS.red },
  'Sleep': { icon: <Moon size={14} />, color: COLORS.cyan },
  'Respiratory Rate': { icon: <Wind size={14} />, color: COLORS.zinc },
  'Blood Oxygen': { icon: <Droplets size={14} />, color: COLORS.blue },
  'Weight': { icon: <Scale size={14} />, color: COLORS.orange },
  'Steps': { icon: <Footprints size={14} />, color: COLORS.blue },
  'Active Energy': { icon: <Flame size={14} />, color: COLORS.orange },
  'Distance': { icon: <MapPin size={14} />, color: COLORS.green },
  'Exercise': { icon: <Dumbbell size={14} />, color: COLORS.pink },
}

function TrendCard({ trend }: { trend: MultiWindowTrend }) {
  const decimals = trend.unit === 'kcal' || trend.unit === '/day' || trend.unit === 'min' || trend.unit === 'br/min' ? 0 : 1
  // Shared y-scale across all windows so visual magnitudes are honest.
  let sparkMin = Infinity, sparkMax = -Infinity
  for (const row of trend.windows) {
    for (const v of row.spark) {
      if (v < sparkMin) sparkMin = v
      if (v > sparkMax) sparkMax = v
    }
  }
  const style = METRIC_STYLE[trend.metric]
  const accent = style?.color || '#71717a'
  return (
    <div className="rounded-xl border border-zinc-800/60 p-4">
      <div className="flex items-center justify-between mb-3 gap-2">
        <div className="flex items-center gap-1.5 min-w-0 text-[12px] font-medium text-zinc-300">
          {style?.icon ? (
            <span className="shrink-0" style={{ color: accent }}>{style.icon}</span>
          ) : (
            <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ backgroundColor: accent }} />
          )}
          <span className="truncate">{trend.metric}</span>
          <span className="text-[10px] uppercase tracking-wider text-zinc-600 shrink-0 ml-1">{CATEGORY_LABEL[trend.category]}</span>
        </div>
        <div className="text-xs font-mono text-zinc-500 shrink-0">
          <span className="text-zinc-300">{fmt(trend.latest, decimals)}</span> {trend.unit}
        </div>
      </div>
      <div className="divide-y divide-zinc-800/60">
        {trend.windows.map(row => {
          const color = rowColor(row)
          return (
            <div key={row.days} className="grid grid-cols-[60px_1fr_96px] items-center gap-3 py-2">
              <div className="text-xs text-zinc-500 tabular-nums">{row.days} days</div>
              <div className="flex items-center gap-1.5 text-xs font-mono tabular-nums" style={{ color }}>
                <TrendArrow direction={row.direction} />
                <span>{formatDelta(row, trend.unit)}</span>
                <span className="text-zinc-600 ml-1">({row.changePercent > 0 ? '+' : ''}{row.changePercent}%)</span>
              </div>
              <div className="flex justify-end">
                <Sparkline data={row.spark} color={color} height={20} width={88} min={sparkMin} max={sparkMax} />
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

export default function Trends({ data, metrics }: Props) {
  const trends = useMemo(() => {
    const inputs = buildInputs(data, metrics)
    return computeMultiWindowTrends(inputs)
  }, [data, metrics])

  if (trends.length === 0) {
    return (
      <div className="text-center py-12 text-zinc-500 text-sm">
        Not enough history yet to compute trends. Come back after a couple of weeks of data.
      </div>
    )
  }

  // Sort by CATEGORY_ORDER, preserving in-category order
  const ordered = [...trends].sort(
    (a, b) => CATEGORY_ORDER.indexOf(a.category) - CATEGORY_ORDER.indexOf(b.category),
  )

  return (
    <div className="space-y-4">
      <SubsectionHeader title="Trends" description="How your key metrics are moving across multiple time windows. Each row compares the recent window to the window before it." />
      <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-3">
        {ordered.map(t => <TrendCard key={t.metric} trend={t} />)}
      </div>
    </div>
  )
}
