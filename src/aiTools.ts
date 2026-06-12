import type {
  DailyMetrics,
  HealthData,
  SleepRecord,
  Workout,
} from './types'
import type { Locale } from './i18n'

export type HealthToolName =
  | 'list_available_metrics'
  | 'get_metric_series'
  | 'get_metric_summary'
  | 'get_sleep_records'
  | 'get_workouts'
  | 'get_correlations'

export type HealthToolCall = {
  name: HealthToolName
  reason?: string
  args?: Record<string, unknown>
}

export type HealthToolResult = {
  name: HealthToolName
  label: string
  reason?: string
  args: Record<string, unknown>
  summary: string
  rowCount: number
  data: unknown
  warnings?: string[]
}

export type HealthToolReference = {
  name: HealthToolName
  label: string
  reason?: string
  argsSummary: string
  summary: string
  rowCount: number
  warnings?: string[]
}

export type HealthToolCurrentView = {
  tab: string
  label?: string
  range?: string
  granularity?: string
  cutoffDate?: string
}

type Granularity = 'daily' | 'weekly' | 'monthly'
type DatedValue = { date: string; value: number | null }

type MetricDefinition = {
  id: string
  label: string
  unit: string
  aliases: string[]
  read: (data: HealthData, metrics: DailyMetrics[]) => DatedValue[]
}

const dailyMetric = (
  id: string,
  label: string,
  unit: string,
  key: keyof DailyMetrics,
  aliases: string[] = [],
): MetricDefinition => ({
  id,
  label,
  unit,
  aliases,
  read: (_data, metrics) => metrics.map(m => {
    const raw = m[key]
    const value = typeof raw === 'number' && Number.isFinite(raw) ? raw : null
    return { date: m.date, value }
  }),
})

const metricDefinitions: MetricDefinition[] = [
  dailyMetric('steps', 'Steps', 'steps', 'steps', ['step count']),
  dailyMetric('active_energy', 'Active Energy', 'kcal', 'activeEnergy', ['calories', 'energy']),
  dailyMetric('resting_heart_rate', 'Resting Heart Rate', 'bpm', 'restingHeartRate', ['rhr', 'resting hr']),
  dailyMetric('hrv', 'HRV', 'ms', 'hrv', ['heart rate variability']),
  dailyMetric('vo2max', 'VO2 Max', 'mL/kg/min', 'vo2max', ['vo2', 'cardio fitness']),
  dailyMetric('weight', 'Weight', 'kg', 'weight', ['body weight']),
  dailyMetric('sleep_hours', 'Sleep Duration', 'h', 'sleepHours', ['sleep', 'total sleep', 'sleep time']),
  dailyMetric('distance', 'Distance', 'km', 'distance', ['walking running distance']),
  dailyMetric('exercise_minutes', 'Exercise Minutes', 'min', 'exerciseMinutes', ['exercise', 'activity minutes']),
  dailyMetric('stand_hours', 'Stand Hours', 'h', 'standHours', ['stand']),
  {
    id: 'body_fat',
    label: 'Body Fat',
    unit: '%',
    aliases: ['body fat percentage'],
    read: data => data.bodyRecords.map(r => ({ date: r.date, value: r.bodyFat })),
  },
  {
    id: 'lean_mass',
    label: 'Lean Body Mass',
    unit: 'kg',
    aliases: ['lean mass'],
    read: data => data.bodyRecords.map(r => ({ date: r.date, value: r.leanMass })),
  },
  {
    id: 'bmi',
    label: 'BMI',
    unit: '',
    aliases: ['body mass index'],
    read: data => data.bodyRecords.map(r => ({ date: r.date, value: r.bmi })),
  },
  {
    id: 'breathing_disturbances',
    label: 'Breathing Disturbances',
    unit: 'events/hr',
    aliases: ['disturbances', 'sleep apnea', 'apnea'],
    read: data => data.dailyBreathing.map(r => ({ date: r.date, value: r.disturbances })),
  },
  {
    id: 'respiratory_rate',
    label: 'Respiratory Rate',
    unit: 'breaths/min',
    aliases: ['respiration', 'breathing rate'],
    read: data => data.dailyBreathing.map(r => ({ date: r.date, value: r.respiratoryRate })),
  },
  {
    id: 'spo2',
    label: 'Blood Oxygen',
    unit: '%',
    aliases: ['oxygen saturation', 'blood oxygen'],
    read: data => data.dailyBreathing.map(r => ({ date: r.date, value: r.spo2 })),
  },
  {
    id: 'daylight_minutes',
    label: 'Daylight Exposure',
    unit: 'min',
    aliases: ['daylight', 'sunlight', 'outdoor light'],
    read: data => data.dailyDaylight.map(r => ({ date: r.date, value: r.minutes })),
  },
  {
    id: 'headphone_audio_avg',
    label: 'Headphone Audio Average',
    unit: 'dB',
    aliases: ['headphone audio', 'headphone noise'],
    read: data => data.dailyAudio.map(r => ({ date: r.date, value: r.headphoneAvg })),
  },
  {
    id: 'environmental_noise_avg',
    label: 'Environmental Noise Average',
    unit: 'dB',
    aliases: ['environmental noise', 'ambient noise'],
    read: data => data.dailyAudio.map(r => ({ date: r.date, value: r.envAvg })),
  },
  {
    id: 'walking_speed',
    label: 'Walking Speed',
    unit: 'km/h',
    aliases: ['gait speed'],
    read: data => data.dailyMobility.map(r => ({ date: r.date, value: r.walkingSpeed })),
  },
  {
    id: 'step_length',
    label: 'Step Length',
    unit: 'cm',
    aliases: ['stride length walking'],
    read: data => data.dailyMobility.map(r => ({ date: r.date, value: r.stepLength })),
  },
  {
    id: 'double_support_pct',
    label: 'Double Support Time',
    unit: '%',
    aliases: ['double support'],
    read: data => data.dailyMobility.map(r => ({ date: r.date, value: r.doubleSupportPct })),
  },
  {
    id: 'walking_asymmetry_pct',
    label: 'Walking Asymmetry',
    unit: '%',
    aliases: ['asymmetry'],
    read: data => data.dailyMobility.map(r => ({ date: r.date, value: r.asymmetryPct })),
  },
  {
    id: 'flights_climbed',
    label: 'Flights Climbed',
    unit: 'flights',
    aliases: ['stairs', 'floors climbed'],
    read: data => data.dailyMobility.map(r => ({ date: r.date, value: r.flightsClimbed })),
  },
  {
    id: 'walking_steadiness',
    label: 'Walking Steadiness',
    unit: '%',
    aliases: ['steadiness', 'fall risk'],
    read: data => data.dailyMobility.map(r => ({ date: r.date, value: r.walkingSteadiness })),
  },
  {
    id: 'six_min_walk_distance',
    label: 'Six-Minute Walk Distance',
    unit: 'm',
    aliases: ['six minute walk'],
    read: data => data.dailyMobility.map(r => ({ date: r.date, value: r.sixMinWalkDistance })),
  },
  {
    id: 'running_power',
    label: 'Running Power',
    unit: 'W',
    aliases: ['power'],
    read: data => data.runningDynamics.map(r => ({ date: r.date, value: r.power })),
  },
  {
    id: 'running_speed',
    label: 'Running Speed',
    unit: 'm/s',
    aliases: ['running pace', 'pace'],
    read: data => data.runningDynamics.map(r => ({ date: r.date, value: r.speed })),
  },
  {
    id: 'vertical_oscillation',
    label: 'Vertical Oscillation',
    unit: 'cm',
    aliases: ['bounce'],
    read: data => data.runningDynamics.map(r => ({ date: r.date, value: r.verticalOscillation })),
  },
  {
    id: 'ground_contact_time',
    label: 'Ground Contact Time',
    unit: 'ms',
    aliases: ['gct'],
    read: data => data.runningDynamics.map(r => ({ date: r.date, value: r.groundContactTime })),
  },
  {
    id: 'stride_length',
    label: 'Stride Length',
    unit: 'm',
    aliases: ['running stride'],
    read: data => data.runningDynamics.map(r => ({ date: r.date, value: r.strideLength })),
  },
  {
    id: 'garmin_training_readiness',
    label: 'Garmin Training Readiness',
    unit: 'score',
    aliases: ['training readiness', 'readiness'],
    read: data => data.garminMetrics?.trainingReadiness.map(r => ({ date: r.date, value: r.score })) ?? [],
  },
  {
    id: 'garmin_sleep_score',
    label: 'Garmin Sleep Score',
    unit: 'score',
    aliases: ['sleep score'],
    read: data => data.garminMetrics?.sleepScores.map(r => ({ date: r.date, value: r.overall })) ?? [],
  },
  {
    id: 'garmin_stress',
    label: 'Garmin Stress',
    unit: 'score',
    aliases: ['stress'],
    read: data => data.garminMetrics?.stressDaily.map(r => ({ date: r.date, value: r.avgStress })) ?? [],
  },
  {
    id: 'garmin_acute_training_load',
    label: 'Garmin Acute Training Load',
    unit: 'load',
    aliases: ['acute load', 'atl'],
    read: data => data.garminMetrics?.acuteTrainingLoad.map(r => ({ date: r.date, value: r.acute })) ?? [],
  },
]

function compactKey(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '')
}

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function asNumber(value: unknown, fallback: number): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string') {
    const parsed = Number(value)
    if (Number.isFinite(parsed)) return parsed
  }
  return fallback
}

function clampInt(value: unknown, fallback: number, min: number, max: number): number {
  const parsed = Math.trunc(asNumber(value, fallback))
  return Math.min(max, Math.max(min, parsed))
}

function asGranularity(value: unknown, fallback: Granularity): Granularity {
  return value === 'daily' || value === 'weekly' || value === 'monthly' ? value : fallback
}

function avg(values: number[]): number | null {
  return values.length ? round(values.reduce((sum, value) => sum + value, 0) / values.length) : null
}

function round(value: number, digits = 2): number {
  const factor = 10 ** digits
  return Math.round(value * factor) / factor
}

function numericPoints(points: DatedValue[]): { date: string; value: number }[] {
  return points
    .filter((point): point is { date: string; value: number } => typeof point.value === 'number' && Number.isFinite(point.value))
    .sort((a, b) => a.date.localeCompare(b.date))
}

function latestDate(data: HealthData, metrics: DailyMetrics[]): string {
  const dates = [
    ...metrics.map(m => m.date),
    ...data.workouts.map(w => w.date),
    ...data.sleepRecords.map(r => r.date),
    ...data.bodyRecords.map(r => r.date),
    ...data.cardioRecords.map(r => r.date),
    ...data.dailyBreathing.map(r => r.date),
    ...data.dailyDaylight.map(r => r.date),
    ...data.dailyMobility.map(r => r.date),
    ...data.runningDynamics.map(r => r.date),
  ].filter(Boolean)
  dates.sort()
  return dates[dates.length - 1] ?? new Date().toISOString().slice(0, 10)
}

function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10)
}

function cutoffForDays(latest: string, days: number): string {
  const date = new Date(`${latest}T00:00:00Z`)
  date.setUTCDate(date.getUTCDate() - Math.max(0, days - 1))
  return isoDate(date)
}

function filterByDays<T extends { date: string }>(rows: T[], latest: string, days: number): T[] {
  const cutoff = cutoffForDays(latest, days)
  return rows.filter(row => row.date >= cutoff && row.date <= latest)
}

function weekStart(dateString: string): string {
  const date = new Date(`${dateString}T00:00:00Z`)
  const day = date.getUTCDay() || 7
  date.setUTCDate(date.getUTCDate() - day + 1)
  return isoDate(date)
}

function aggregate(points: { date: string; value: number }[], granularity: Granularity): { date: string; value: number }[] {
  if (granularity === 'daily') return points.map(point => ({ date: point.date, value: round(point.value) }))

  const grouped = new Map<string, number[]>()
  for (const point of points) {
    const key = granularity === 'weekly' ? weekStart(point.date) : point.date.slice(0, 7)
    const values = grouped.get(key) ?? []
    values.push(point.value)
    grouped.set(key, values)
  }

  return Array.from(grouped.entries())
    .map(([date, values]) => ({ date, value: round(avg(values) ?? 0) }))
    .sort((a, b) => a.date.localeCompare(b.date))
}

function sampleRows<T>(rows: T[], maxRows: number): T[] {
  if (rows.length <= maxRows) return rows
  const step = Math.ceil(rows.length / maxRows)
  return rows.filter((_row, index) => index % step === 0).slice(0, maxRows)
}

function resolveMetric(metric: unknown): MetricDefinition | null {
  const value = asString(metric)
  if (!value) return null
  const key = compactKey(value)
  return metricDefinitions.find(def => {
    const candidates = [def.id, def.label, ...def.aliases]
    return candidates.some(candidate => compactKey(candidate) === key)
  }) ?? null
}

function availableMetrics(data: HealthData, metrics: DailyMetrics[]) {
  return metricDefinitions
    .map(def => {
      const points = numericPoints(def.read(data, metrics))
      return {
        id: def.id,
        label: def.label,
        unit: def.unit,
        count: points.length,
        firstDate: points[0]?.date ?? null,
        lastDate: points[points.length - 1]?.date ?? null,
      }
    })
    .filter(metric => metric.count > 0)
}

function describeArgs(args: Record<string, unknown>): string {
  const parts = Object.entries(args)
    .filter(([, value]) => value !== undefined && value !== null && value !== '')
    .map(([key, value]) => `${key}: ${String(value)}`)
  return parts.join(', ')
}

function emptyResult(call: HealthToolCall, message: string): HealthToolResult {
  return {
    name: call.name,
    label: call.name,
    reason: call.reason,
    args: call.args ?? {},
    summary: message,
    rowCount: 0,
    data: null,
    warnings: [message],
  }
}

function runListAvailableMetrics(call: HealthToolCall, data: HealthData, metrics: DailyMetrics[]): HealthToolResult {
  const rows = availableMetrics(data, metrics)
  return {
    name: 'list_available_metrics',
    label: 'Available metrics',
    reason: call.reason,
    args: {},
    summary: `${rows.length} metrics are available in the local import.`,
    rowCount: rows.length,
    data: rows,
  }
}

function runMetricSeries(call: HealthToolCall, data: HealthData, metrics: DailyMetrics[]): HealthToolResult {
  const args = call.args ?? {}
  const def = resolveMetric(args.metric)
  if (!def) return emptyResult(call, `Unknown metric: ${String(args.metric ?? '')}`)

  const days = clampInt(args.days, 90, 7, 365)
  const granularity = asGranularity(args.granularity, 'daily')
  const latest = latestDate(data, metrics)
  const points = filterByDays(numericPoints(def.read(data, metrics)), latest, days)
  const aggregated = aggregate(points, granularity)
  const rows = sampleRows(aggregated, 180)
  const sampled = rows.length < aggregated.length
  const values = aggregated.map(point => point.value)

  return {
    name: 'get_metric_series',
    label: `${def.label} series`,
    reason: call.reason,
    args: { metric: def.id, days, granularity },
    summary: `${def.label}: ${aggregated.length} ${granularity} points over ${days} days, avg ${avg(values) ?? 'N/A'}${def.unit ? ` ${def.unit}` : ''}${sampled ? ', sampled for size' : ''}.`,
    rowCount: aggregated.length,
    data: {
      metric: def.id,
      label: def.label,
      unit: def.unit,
      granularity,
      points: rows,
      sampled,
    },
  }
}

function runMetricSummary(call: HealthToolCall, data: HealthData, metrics: DailyMetrics[]): HealthToolResult {
  const args = call.args ?? {}
  const def = resolveMetric(args.metric)
  if (!def) return emptyResult(call, `Unknown metric: ${String(args.metric ?? '')}`)

  const days = clampInt(args.days, 90, 7, 365)
  const latest = latestDate(data, metrics)
  const recent = filterByDays(numericPoints(def.read(data, metrics)), latest, days)
  if (recent.length === 0) {
    return emptyResult({ ...call, args: { metric: def.id, days } }, `No ${def.label} data found in the selected window.`)
  }

  const previousEnd = new Date(`${cutoffForDays(latest, days)}T00:00:00Z`)
  previousEnd.setUTCDate(previousEnd.getUTCDate() - 1)
  const previousLatest = isoDate(previousEnd)
  const previous = filterByDays(numericPoints(def.read(data, metrics)), previousLatest, days)

  const values = recent.map(point => point.value)
  const recentAvg = avg(values)
  const previousAvg = avg(previous.map(point => point.value))
  const minPoint = recent.reduce((best, point) => point.value < best.value ? point : best, recent[0])
  const maxPoint = recent.reduce((best, point) => point.value > best.value ? point : best, recent[0])
  const latestPoint = recent[recent.length - 1]
  const mean = recentAvg ?? 0
  const variance = avg(values.map(value => (value - mean) ** 2)) ?? 0
  const sd = Math.sqrt(variance)
  const outliers = sd > 0
    ? recent
      .map(point => ({ ...point, z: round((point.value - mean) / sd) }))
      .filter(point => Math.abs(point.z) >= 2)
      .sort((a, b) => Math.abs(b.z) - Math.abs(a.z))
      .slice(0, 12)
    : []
  const changePct = recentAvg !== null && previousAvg !== null && previousAvg !== 0
    ? round((recentAvg - previousAvg) / Math.abs(previousAvg) * 100, 1)
    : null

  return {
    name: 'get_metric_summary',
    label: `${def.label} summary`,
    reason: call.reason,
    args: { metric: def.id, days },
    summary: `${def.label}: avg ${recentAvg}${def.unit ? ` ${def.unit}` : ''}, latest ${latestPoint.value}${def.unit ? ` ${def.unit}` : ''} on ${latestPoint.date}${changePct !== null ? `, ${changePct}% vs prior window` : ''}.`,
    rowCount: recent.length,
    data: {
      metric: def.id,
      label: def.label,
      unit: def.unit,
      days,
      count: recent.length,
      avg: recentAvg,
      previousAvg,
      changePct,
      min: { date: minPoint.date, value: minPoint.value },
      max: { date: maxPoint.date, value: maxPoint.value },
      latest: { date: latestPoint.date, value: latestPoint.value },
      outliers,
    },
  }
}

function recordTime(record: SleepRecord, field: 'startDate' | 'endDate'): string | null {
  const date = new Date(record[field])
  if (!Number.isFinite(date.getTime())) return null
  return date.toISOString()
}

function runSleepRecords(call: HealthToolCall, data: HealthData, metrics: DailyMetrics[]): HealthToolResult {
  const args = call.args ?? {}
  const days = clampInt(args.days, 30, 7, 180)
  const latest = latestDate(data, metrics)
  const records = filterByDays(data.sleepRecords, latest, days)
  const byDate = new Map<string, {
    date: string
    core: number
    deep: number
    rem: number
    awake: number
    inbed: number
    unspecified: number
    total: number
    firstSleepStart: string | null
    finalSleepEnd: string | null
  }>()

  for (const record of records) {
    const row = byDate.get(record.date) ?? {
      date: record.date,
      core: 0,
      deep: 0,
      rem: 0,
      awake: 0,
      inbed: 0,
      unspecified: 0,
      total: 0,
      firstSleepStart: null,
      finalSleepEnd: null,
    }
    row[record.stage] += record.minutes
    if (record.stage === 'core' || record.stage === 'deep' || record.stage === 'rem' || record.stage === 'unspecified') {
      row.total += record.minutes
      const start = recordTime(record, 'startDate')
      const end = recordTime(record, 'endDate')
      if (start && (!row.firstSleepStart || start < row.firstSleepStart)) row.firstSleepStart = start
      if (end && (!row.finalSleepEnd || end > row.finalSleepEnd)) row.finalSleepEnd = end
    }
    byDate.set(record.date, row)
  }

  const rows = Array.from(byDate.values())
    .sort((a, b) => a.date.localeCompare(b.date))
    .map(row => ({
      ...row,
      core: round(row.core / 60, 2),
      deep: round(row.deep / 60, 2),
      rem: round(row.rem / 60, 2),
      awake: round(row.awake / 60, 2),
      inbed: round(row.inbed / 60, 2),
      unspecified: round(row.unspecified / 60, 2),
      total: round(row.total / 60, 2),
    }))

  return {
    name: 'get_sleep_records',
    label: 'Sleep records',
    reason: call.reason,
    args: { days },
    summary: `Sleep records: ${rows.length} nights over ${days} days, avg total ${avg(rows.map(row => row.total)) ?? 'N/A'} h.`,
    rowCount: rows.length,
    data: {
      days,
      nights: rows,
    },
  }
}

function workoutMatchesType(workout: Workout, type: string | null): boolean {
  if (!type) return true
  return workout.type.toLowerCase().includes(type.toLowerCase())
}

function runWorkouts(call: HealthToolCall, data: HealthData, metrics: DailyMetrics[]): HealthToolResult {
  const args = call.args ?? {}
  const days = clampInt(args.days, 90, 7, 365)
  const type = asString(args.type)
  const latest = latestDate(data, metrics)
  const workouts = filterByDays(data.workouts, latest, days)
    .filter(workout => workoutMatchesType(workout, type))
    .sort((a, b) => a.date.localeCompare(b.date))
  const typeCounts = new Map<string, number>()
  for (const workout of workouts) typeCounts.set(workout.type, (typeCounts.get(workout.type) ?? 0) + 1)

  return {
    name: 'get_workouts',
    label: 'Workouts',
    reason: call.reason,
    args: { days, ...(type ? { type } : {}) },
    summary: `Workouts: ${workouts.length} sessions over ${days} days${type ? ` matching "${type}"` : ''}.`,
    rowCount: workouts.length,
    data: {
      days,
      type,
      typeCounts: Array.from(typeCounts.entries()).map(([name, count]) => ({ type: name, count })),
      totalDurationMin: round(workouts.reduce((sum, workout) => sum + workout.duration, 0)),
      avgHeartRate: avg(workouts.map(workout => workout.hrAvg).filter((value): value is number => value !== null)),
      workouts: workouts.slice(-120).map(workout => ({
        type: workout.type,
        date: workout.date,
        duration: round(workout.duration),
        calories: round(workout.calories),
        distance: workout.distance,
        hrAvg: workout.hrAvg,
        hrMin: workout.hrMin,
        hrMax: workout.hrMax,
        elevationAscended: workout.elevationAscended,
      })),
      truncated: workouts.length > 120,
    },
  }
}

function pearson(pairs: { x: number; y: number }[]): number | null {
  if (pairs.length < 3) return null
  const xs = pairs.map(pair => pair.x)
  const ys = pairs.map(pair => pair.y)
  const xAvg = avg(xs) ?? 0
  const yAvg = avg(ys) ?? 0
  let numerator = 0
  let xDen = 0
  let yDen = 0
  for (const pair of pairs) {
    const dx = pair.x - xAvg
    const dy = pair.y - yAvg
    numerator += dx * dy
    xDen += dx * dx
    yDen += dy * dy
  }
  const denominator = Math.sqrt(xDen * yDen)
  return denominator > 0 ? round(numerator / denominator, 3) : null
}

function runCorrelation(call: HealthToolCall, data: HealthData, metrics: DailyMetrics[]): HealthToolResult {
  const args = call.args ?? {}
  const xDef = resolveMetric(args.metricX ?? args.x)
  const yDef = resolveMetric(args.metricY ?? args.y)
  if (!xDef || !yDef) return emptyResult(call, 'Unknown correlation metric.')

  const days = clampInt(args.days, 180, 14, 365)
  const latest = latestDate(data, metrics)
  const xPoints = filterByDays(numericPoints(xDef.read(data, metrics)), latest, days)
  const yPoints = filterByDays(numericPoints(yDef.read(data, metrics)), latest, days)
  const yByDate = new Map(yPoints.map(point => [point.date, point.value]))
  const pairs = xPoints
    .map(point => ({ date: point.date, x: point.value, y: yByDate.get(point.date) }))
    .filter((point): point is { date: string; x: number; y: number } => typeof point.y === 'number')
  const r = pearson(pairs)

  return {
    name: 'get_correlations',
    label: `${xDef.label} vs ${yDef.label}`,
    reason: call.reason,
    args: { metricX: xDef.id, metricY: yDef.id, days },
    summary: `${xDef.label} vs ${yDef.label}: r=${r ?? 'N/A'} across ${pairs.length} paired days.`,
    rowCount: pairs.length,
    data: {
      metricX: xDef.id,
      metricY: yDef.id,
      days,
      correlation: r,
      pairCount: pairs.length,
      pairs: sampleRows(pairs, 120),
      sampled: pairs.length > 120,
    },
  }
}

function normalizeToolCall(raw: unknown): HealthToolCall | null {
  if (!raw || typeof raw !== 'object') return null
  const candidate = raw as { name?: unknown; args?: unknown; reason?: unknown }
  const name = candidate.name
  if (
    name !== 'list_available_metrics' &&
    name !== 'get_metric_series' &&
    name !== 'get_metric_summary' &&
    name !== 'get_sleep_records' &&
    name !== 'get_workouts' &&
    name !== 'get_correlations'
  ) {
    return null
  }
  return {
    name,
    reason: asString(candidate.reason) ?? undefined,
    args: candidate.args && typeof candidate.args === 'object' && !Array.isArray(candidate.args)
      ? candidate.args as Record<string, unknown>
      : {},
  }
}

function extractJsonObject(text: string): unknown | null {
  const trimmed = text.trim()
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i)
  const body = fenced?.[1]?.trim() ?? trimmed
  try {
    return JSON.parse(body)
  } catch {
    const start = body.indexOf('{')
    const end = body.lastIndexOf('}')
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(body.slice(start, end + 1))
      } catch {
        return null
      }
    }
    return null
  }
}

export function parseHealthToolPlan(text: string): HealthToolCall[] {
  const parsed = extractJsonObject(text)
  if (!parsed || typeof parsed !== 'object') return []
  const object = parsed as { toolCalls?: unknown; tools?: unknown }
  const rawCalls = Array.isArray(object.toolCalls)
    ? object.toolCalls
    : Array.isArray(object.tools)
      ? object.tools
      : []
  const calls = rawCalls
    .map(normalizeToolCall)
    .filter((call): call is HealthToolCall => call !== null)
    .slice(0, 6)
  const seen = new Set<string>()
  return calls.filter(call => {
    const key = `${call.name}:${JSON.stringify(call.args ?? {})}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

export function runHealthTool(call: HealthToolCall, data: HealthData, metrics: DailyMetrics[]): HealthToolResult {
  try {
    if (call.name === 'list_available_metrics') return runListAvailableMetrics(call, data, metrics)
    if (call.name === 'get_metric_series') return runMetricSeries(call, data, metrics)
    if (call.name === 'get_metric_summary') return runMetricSummary(call, data, metrics)
    if (call.name === 'get_sleep_records') return runSleepRecords(call, data, metrics)
    if (call.name === 'get_workouts') return runWorkouts(call, data, metrics)
    if (call.name === 'get_correlations') return runCorrelation(call, data, metrics)
    return emptyResult(call, `Unsupported tool: ${call.name}`)
  } catch (error) {
    return emptyResult(call, error instanceof Error ? error.message : String(error))
  }
}

export function toToolReference(result: HealthToolResult): HealthToolReference {
  return {
    name: result.name,
    label: result.label,
    reason: result.reason,
    argsSummary: describeArgs(result.args),
    summary: result.summary,
    rowCount: result.rowCount,
    warnings: result.warnings,
  }
}

export function buildHealthToolPlanningPrompt(
  locale: Locale,
  data: HealthData,
  metrics: DailyMetrics[],
  currentView?: HealthToolCurrentView,
): string {
  const inventory = {
    currentView,
    latestDate: latestDate(data, metrics),
    dataset: {
      days: metrics.length,
      workouts: data.workouts.length,
      sleepRecords: data.sleepRecords.length,
      source: data.sourceMode ?? 'apple',
    },
    metrics: availableMetrics(data, metrics),
  }
  const responseLanguage = locale === 'zh' ? 'Chinese' : 'English'
  return `You are planning local health-data lookups before answering a user.

Return only valid JSON in this exact shape:
{"toolCalls":[{"name":"get_metric_summary","reason":"why this data is needed","args":{"metric":"hrv","days":90}}]}

Do not answer the user. Choose only the data needed for the question. Use at most 6 tool calls. The user is currently viewing the dashboard module shown in currentView; use that as a strong hint when the question is ambiguous. Prefer get_metric_summary for trend or anomaly questions, get_metric_series when exact day-by-day values are needed, get_sleep_records for sleep-stage or schedule questions, get_workouts for training questions, and get_correlations for relationship questions.

Available tools:
- list_available_metrics args {}
- get_metric_summary args {"metric": metric_id, "days": 7-365}
- get_metric_series args {"metric": metric_id, "days": 7-365, "granularity": "daily"|"weekly"|"monthly"}
- get_sleep_records args {"days": 7-180}
- get_workouts args {"days": 7-365, "type": optional string}
- get_correlations args {"metricX": metric_id, "metricY": metric_id, "days": 14-365}

Use these exact metric ids when requesting metric tools. The final answer will be in ${responseLanguage}.
${JSON.stringify(inventory)}`
}

export function buildToolResultsContext(results: HealthToolResult[], locale: Locale): string {
  if (results.length === 0) return ''
  const intro = locale === 'zh'
    ? '以下是针对本次问题在浏览器本地查询到的健康数据结果。请优先基于这些结果回答，不要编造未查询到的数据。'
    : 'These are the local browser health-data lookups retrieved for this question. Use them as primary evidence and do not invent data that was not retrieved.'
  return `${intro}\n${JSON.stringify(results.map(result => ({
    tool: result.name,
    label: result.label,
    reason: result.reason,
    args: result.args,
    summary: result.summary,
    rowCount: result.rowCount,
    data: result.data,
    warnings: result.warnings,
  })), null, 2)}`
}
