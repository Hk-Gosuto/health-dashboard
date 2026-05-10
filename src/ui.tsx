import { memo, useState, useCallback, useRef, useEffect } from 'react'
import type { ReactNode } from 'react'
import { ResponsiveContainer } from 'recharts'
import { ArrowUpRight, ArrowDownRight } from 'lucide-react'

// === Colors ===
export const COLORS = {
  green: '#22c55e',
  red: '#ef4444',
  blue: '#3b82f6',
  purple: '#a855f7',
  orange: '#f97316',
  pink: '#ec4899',
  cyan: '#06b6d4',
  yellow: '#facc15',
  zinc: '#71717a',
}

// === Chart constants ===
function isDarkMode(): boolean {
  return document.documentElement.classList.contains('dark')
}

export function getTooltipStyle() {
  const dark = isDarkMode()
  return {
    contentStyle: {
      background: dark ? '#101014' : '#ffffff',
      border: `1px solid ${dark ? '#27272a' : '#e4e4e7'}`,
      borderRadius: 8,
      fontSize: 12,
      color: dark ? '#e4e4e7' : '#27272a',
    },
    labelStyle: { color: dark ? '#a1a1aa' : '#71717a' },
  }
}

// Static default for backwards compat — components that import this still work
export const tooltipStyle = {
  contentStyle: { background: '#101014', border: '1px solid #27272a', borderRadius: 8, fontSize: 12 },
  labelStyle: { color: '#a1a1aa' },
}

export function useChartTheme() {
  // Re-reads CSS vars each render so theme toggle is reflected
  const dark = isDarkMode()
  return {
    grid: dark ? '#27272a' : '#e4e4e7',
    tick: '#71717a',
    bg: dark ? '#101014' : '#f4f4f5',
    tooltip: {
      contentStyle: {
        background: dark ? '#101014' : '#ffffff',
        border: `1px solid ${dark ? '#27272a' : '#e4e4e7'}`,
        borderRadius: 8,
        fontSize: 12,
        color: dark ? '#e4e4e7' : '#27272a',
      },
      labelStyle: { color: dark ? '#a1a1aa' : '#71717a' },
    },
  }
}

export const chartMargin = { top: 5, right: 5, bottom: 0, left: -15 }

// === Custom Tooltip ===
interface TooltipPayloadItem {
  name: string
  value: number
  color: string
  dataKey: string
  payload: Record<string, unknown>
}

export function ChartTooltip({ active, payload, label, formatter }: {
  active?: boolean
  payload?: TooltipPayloadItem[]
  label?: string | number
  formatter?: (value: number, name: string) => [string, string]
}) {
  if (!active || !payload || payload.length === 0) return null
  const dark = isDarkMode()

  // Format the date label nicely. Recharts may hand us a number for numeric XAxis charts.
  let dateLabel = label == null ? '' : String(label)
  if (dateLabel && /^\d{4}-\d{2}/.test(dateLabel)) {
    const parts = dateLabel.split('-')
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
    dateLabel = parts[2]
      ? `${months[parseInt(parts[1]) - 1]} ${parseInt(parts[2])}, ${parts[0]}`
      : `${months[parseInt(parts[1]) - 1]} ${parts[0]}`
  }

  return (
    <div style={{
      background: dark ? '#101014' : '#ffffff',
      border: `1px solid ${dark ? '#27272a' : '#e4e4e7'}`,
      borderRadius: 10,
      padding: '8px 12px',
      fontSize: 12,
      boxShadow: dark ? '0 4px 12px rgba(0,0,0,0.5)' : '0 4px 12px rgba(0,0,0,0.1)',
    }}>
      {dateLabel && (
        <div style={{ color: dark ? '#71717a' : '#a1a1aa', fontSize: 10, marginBottom: 4, fontWeight: 500 }}>
          {dateLabel}
        </div>
      )}
      {payload.map((entry, i) => {
        const [formattedValue, formattedName] = formatter
          ? formatter(entry.value, entry.name || entry.dataKey)
          : [`${entry.value}`, entry.name || entry.dataKey]
        return (
          <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: i > 0 ? 3 : 0 }}>
            <div style={{ width: 8, height: 8, borderRadius: '50%', background: entry.color, flexShrink: 0 }} />
            <span style={{ color: dark ? '#a1a1aa' : '#71717a' }}>{formattedName}</span>
            <span style={{ color: dark ? '#e4e4e7' : '#18181b', fontWeight: 600, marginLeft: 'auto', paddingLeft: 8 }}>{formattedValue}</span>
          </div>
        )
      })}
    </div>
  )
}

// === Sparkline ===
export function Sparkline({ data, color, height = 24, width = 80, fluid = false, showEndDot = true, min: minOverride, max: maxOverride }: {
  data: number[]; color?: string; height?: number; width?: number; fluid?: boolean; showEndDot?: boolean
  min?: number; max?: number
}) {
  if (data.length < 2) return null
  const min = minOverride ?? Math.min(...data)
  const max = maxOverride ?? Math.max(...data)
  const range = max - min || 1
  const w = width
  const h = height
  const pad = 2
  const points = data.map((v, i) => {
    const x = (i / (data.length - 1)) * w
    const y = pad + (1 - (v - min) / range) * (h - pad * 2)
    return `${x},${y}`
  }).join(' ')
  const c = color || '#71717a'
  const fillPoints = `0,${h} ${points} ${w},${h}`
  const svgProps = fluid
    ? { width: '100%' as const, height: h, preserveAspectRatio: 'none' as const, className: 'block' }
    : { width: w, height: h, className: 'overflow-visible' }
  return (
    <svg {...svgProps} viewBox={`0 0 ${w} ${h}`}>
      <polygon points={fillPoints} fill={c} fillOpacity={0.15} />
      <polyline points={points} fill="none" stroke={c} strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
      {showEndDot && !fluid && (() => {
        const lastY = pad + (1 - (data[data.length - 1] - min) / range) * (h - pad * 2)
        return <circle cx={w} cy={lastY} r={2} fill={c} />
      })()}
    </svg>
  )
}

// === Shared components ===
export function StatBox({ label, value, unit, sub, latest, color, trend, sparkData, icon }: {
  label: string; value: string; unit?: string; sub?: string; latest?: string; color?: string
  trend?: { direction: 'up' | 'down'; positive: boolean; changePercent: number }
  sparkData?: number[]
  icon?: ReactNode
}) {
  const accent = color || '#71717a'
  const hasSpark = !!(sparkData && sparkData.length >= 3)
  return (
    <div className="rounded-xl border border-zinc-800/60 p-4 flex flex-col gap-3 min-h-[140px]">
      <div className="flex items-center gap-1.5 text-[12px] font-medium text-zinc-300">
        {icon ? (
          <span className="shrink-0" style={{ color: accent }}>{icon}</span>
        ) : (
          <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ backgroundColor: accent }} />
        )}
        <span className="truncate">{label}</span>
      </div>
      {hasSpark ? (
        <div className="flex-1 -mx-1">
          <Sparkline data={sparkData!} color={accent} height={36} fluid showEndDot={false} />
        </div>
      ) : <div className="flex-1" />}
      <div className="flex items-end justify-between gap-2">
        <div className="min-w-0">
          <div className="text-[24px] font-semibold tracking-tight tabular-nums leading-none text-zinc-100">
            {value}
            {unit && <span className="text-[12px] text-zinc-500 ml-1 font-normal tabular-nums">{unit}</span>}
          </div>
          {trend ? (
            <div className={`text-[11px] mt-1.5 font-medium tabular-nums inline-flex items-center gap-0.5 ${trend.positive ? 'text-green-400' : 'text-red-400'}`}>
              {trend.direction === 'up' ? <ArrowUpRight size={11} strokeWidth={2.5} /> : <ArrowDownRight size={11} strokeWidth={2.5} />}
              {trend.changePercent}%
              <span className="text-zinc-600 font-normal ml-1">30d</span>
            </div>
          ) : (
            (sub || latest) && (
              <div className="text-zinc-500 text-[10px] mt-1.5 tabular-nums uppercase tracking-wider">
                {sub}
                {latest && <span className="text-zinc-400">{sub ? ' · ' : ''}LATEST {latest}</span>}
              </div>
            )
          )}
        </div>
      </div>
    </div>
  )
}

// Skeleton primitives for loading states
export function SkeletonBlock({ className = '', style }: { className?: string; style?: React.CSSProperties }) {
  return <div className={`bg-zinc-900 rounded-md animate-pulse ${className}`} style={style} />
}

export function TabSkeleton() {
  return (
    <div className="px-4 md:px-6 py-6 space-y-6" aria-hidden>
      <div className="space-y-2">
        <SkeletonBlock className="h-5 w-40" />
        <SkeletonBlock className="h-3 w-64 opacity-60" />
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="bg-zinc-900 rounded-xl p-4 space-y-3">
            <SkeletonBlock className="h-3 w-16 opacity-60" />
            <SkeletonBlock className="h-7 w-24" />
            <SkeletonBlock className="h-3 w-12 opacity-40" />
          </div>
        ))}
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {Array.from({ length: 2 }).map((_, i) => (
          <div key={i} className="bg-zinc-900 rounded-xl p-4 space-y-3">
            <SkeletonBlock className="h-3.5 w-32 opacity-60" />
            <SkeletonBlock className="h-56 w-full opacity-50" />
          </div>
        ))}
      </div>
    </div>
  )
}

export function EmptyState({ icon, title, hint }: { icon?: ReactNode; title: string; hint?: string }) {
  return (
    <div className="flex flex-col items-center justify-center text-center py-24 px-6">
      {icon && <div className="text-zinc-600 mb-4">{icon}</div>}
      <p className="text-sm text-zinc-300">{title}</p>
      {hint && <p className="text-xs text-zinc-500 mt-1.5 max-w-sm leading-relaxed">{hint}</p>}
    </div>
  )
}

export function ProgressBar({ value, max = 1 }: { value: number; max?: number }) {
  const pct = max > 0 ? Math.max(0, Math.min(1, value / max)) : 0
  return (
    <div className="w-full h-1 bg-zinc-800 rounded-full overflow-hidden">
      <div
        className="h-full bg-green-500 rounded-full transition-[width] duration-150 ease-out"
        style={{ width: `${pct * 100}%` }}
      />
    </div>
  )
}

const AI_KEY_STORAGE = 'health-dashboard-ai-key'

function getApiKey(): string | null {
  const envKey = import.meta.env.VITE_OPENROUTER_API_KEY as string | undefined
  if (envKey) return envKey
  return localStorage.getItem(AI_KEY_STORAGE)
}

function hasEnvKey(): boolean {
  return !!import.meta.env.VITE_OPENROUTER_API_KEY
}

function setApiKey(key: string) {
  localStorage.setItem(AI_KEY_STORAGE, key)
}

function sampleData(data: unknown[], maxPoints = 60): unknown[] {
  if (data.length <= maxPoints) return data
  const step = Math.ceil(data.length / maxPoints)
  return data.filter((_, i) => i % step === 0)
}

async function fetchAISummary(title: string, description: string | undefined, data: unknown[], apiKey: string): Promise<string> {
  const sampled = sampleData(data)
  const prompt = `You're a friendly health coach talking directly to the user about their personal health data. Speak in second person ("your", "you've", "you're"). Be warm, specific with numbers, and actionable. Keep it to 3-5 sentences. Highlight what's going well, flag anything worth watching, and suggest one concrete thing they could do.

Chart: "${title}"${description ? `\nDescription: ${description}` : ''}
Their data (${data.length} points${data.length > 60 ? ', sampled' : ''}):
${JSON.stringify(sampled, null, 0)}`

  const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: 'anthropic/claude-sonnet-4',
      max_tokens: 300,
      messages: [{ role: 'user', content: prompt }],
    }),
  })

  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    if (res.status === 401) {
      if (!hasEnvKey()) localStorage.removeItem(AI_KEY_STORAGE)
      throw new Error('Invalid API key. Please try again.')
    }
    throw new Error((err as { error?: { message?: string } }).error?.message || `API error ${res.status}`)
  }

  const body = await res.json() as { choices: { message: { content: string } }[] }
  return body.choices[0].message.content
}

export function AISummaryButton({ title, description, chartData }: {
  title: string; description?: string; chartData: unknown[]
}) {
  const [open, setOpen] = useState(false)
  const [summary, setSummary] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [askingKey, setAskingKey] = useState(false)
  const [keyInput, setKeyInput] = useState('')
  const panelRef = useRef<HTMLDivElement>(null)

  const close = useCallback(() => {
    setOpen(false)
    setSummary(null)
    setError(null)
    setAskingKey(false)
    setKeyInput('')
  }, [])

  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) close()
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open, close])

  const requestSummary = useCallback(async (key: string) => {
    setLoading(true)
    setError(null)
    try {
      const result = await fetchAISummary(title, description, chartData, key)
      setSummary(result)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setLoading(false)
    }
  }, [title, description, chartData])

  const handleClick = useCallback(() => {
    if (open) { close(); return }
    setOpen(true)
    const key = getApiKey()
    if (key) {
      requestSummary(key)
    } else {
      setAskingKey(true)
    }
  }, [open, close, requestSummary])

  const handleKeySubmit = useCallback(() => {
    const key = keyInput.trim()
    if (!key) return
    setApiKey(key)
    setAskingKey(false)
    requestSummary(key)
  }, [keyInput, requestSummary])

  return (
    <div className="relative">
      <button
        onClick={handleClick}
        className="p-1 rounded-md text-zinc-500 hover:text-zinc-200 hover:bg-zinc-800 transition-colors"
        title="AI Summary"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M12 3l1.912 5.813a2 2 0 0 0 1.275 1.275L21 12l-5.813 1.912a2 2 0 0 0-1.275 1.275L12 21l-1.912-5.813a2 2 0 0 0-1.275-1.275L3 12l5.813-1.912a2 2 0 0 0 1.275-1.275L12 3z" />
        </svg>
      </button>
      {open && (
        <div ref={panelRef} className="absolute right-0 top-8 z-50 w-72 sm:w-80 bg-zinc-900 border border-zinc-700 rounded-xl shadow-2xl p-4">
          {askingKey ? (
            <div className="space-y-2">
              <p className="text-xs text-zinc-400">Enter your Anthropic API key to enable AI summaries:</p>
              <input
                type="password"
                value={keyInput}
                onChange={e => setKeyInput(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleKeySubmit()}
                placeholder="sk-ant-..."
                className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-1.5 text-xs text-zinc-200 placeholder-zinc-600 focus:outline-none focus:border-zinc-500"
                autoFocus
              />
              <div className="flex gap-2">
                <button onClick={handleKeySubmit} className="px-3 py-1 bg-zinc-700 hover:bg-zinc-600 text-xs text-zinc-200 rounded-lg transition-colors">Save & Go</button>
                <button onClick={close} className="px-3 py-1 text-xs text-zinc-500 hover:text-zinc-300 transition-colors">Cancel</button>
              </div>
              <p className="text-[10px] text-zinc-600">Key is stored locally in your browser only.</p>
            </div>
          ) : loading ? (
            <div className="flex items-center gap-2 text-xs text-zinc-400">
              <svg className="animate-spin h-3.5 w-3.5" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" /></svg>
              Analyzing...
            </div>
          ) : error ? (
            <div className="space-y-2">
              <p className="text-xs text-red-400">{error}</p>
              <button onClick={() => { const k = getApiKey(); if (k) requestSummary(k); else setAskingKey(true); }} className="text-xs text-zinc-400 hover:text-zinc-200 transition-colors">Retry</button>
            </div>
          ) : summary ? (
            <div className="space-y-2">
              <p className="text-xs text-zinc-300 leading-relaxed whitespace-pre-wrap">{summary}</p>
              <button onClick={close} className="text-[10px] text-zinc-600 hover:text-zinc-400 transition-colors">Close</button>
            </div>
          ) : null}
        </div>
      )}
    </div>
  )
}

export const ChartCard = memo(function ChartCard({ title, description, tall, chartData, icon, color, children }: {
  title: string; description?: string; tall?: boolean; chartData?: unknown[]
  icon?: ReactNode; color?: string
  children: React.ReactNode
}) {
  const accent = color || '#71717a'
  return (
    <div className="rounded-xl border border-zinc-800/60 p-4">
      <div className="flex items-start justify-between mb-3 gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5 text-[12px] font-medium text-zinc-300">
            {icon ? (
              <span className="shrink-0" style={{ color: accent }}>{icon}</span>
            ) : (
              <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ backgroundColor: accent }} />
            )}
            <span className="truncate">{title}</span>
          </div>
          {description && <p className="text-[10px] text-zinc-500 mt-1 uppercase tracking-wider">{description}</p>}
        </div>
        {chartData && chartData.length > 0 && (
          <AISummaryButton title={title} description={description} chartData={chartData} />
        )}
      </div>
      <div className={tall ? 'h-64' : 'h-56'}>
        <ResponsiveContainer width="100%" height="100%" minWidth={0} debounce={1}>
          {children as React.ReactElement}
        </ResponsiveContainer>
      </div>
    </div>
  )
})

export function Legend({ color, label, dashed }: { color: string; label: string; dashed?: boolean }) {
  return (
    <div className="flex items-center gap-1.5 text-xs text-zinc-400">
      <div className="w-4 h-0.5" style={{
        background: dashed ? 'transparent' : color,
        borderTop: dashed ? `2px dashed ${color}` : undefined,
      }} />
      {label}
    </div>
  )
}

export function SectionHeader({ children }: { children: string }) {
  return (
    <h2 className="text-[11px] font-medium tracking-wider uppercase text-zinc-600">
      {children}
    </h2>
  )
}

export function SubsectionHeader({ title, description }: { title: string; description?: string }) {
  return (
    <div>
      <h2 className="text-[22px] font-semibold text-zinc-100 tracking-tight">{title}</h2>
      {description && (
        <p className="text-xs text-zinc-500 mt-1 leading-relaxed">{description}</p>
      )}
    </div>
  )
}

export function TabHeader({ title, description }: { title: string; description: string }) {
  return (
    <div className="mb-6">
      <h1 className="text-[22px] font-semibold text-zinc-100 tracking-tight">{title}</h1>
      <p className="text-xs text-zinc-500 mt-1 leading-relaxed max-w-2xl">{description}</p>
    </div>
  )
}

const WORKOUT_NAME_MAP: Record<string, string> = {
  TraditionalStrengthTraining: 'Strength',
  HighIntensityIntervalTraining: 'HIIT',
  FunctionalStrengthTraining: 'Functional',
  MindAndBody: 'Mind & Body',
  PreparationAndRecovery: 'Recovery',
  CoreTraining: 'Core',
  FlexibilityTraining: 'Flexibility',
  MixedCardio: 'Mixed Cardio',
  StairClimbing: 'Stair Climbing',
  SocialDance: 'Dance',
  CrossTraining: 'Cross Training',
  JumpRope: 'Jump Rope',
  TableTennis: 'Table Tennis',
}

export function humanizeWorkoutType(raw: string): string {
  return WORKOUT_NAME_MAP[raw] || raw.replace(/([a-z])([A-Z])/g, '$1 $2')
}

// === Utility functions ===

// "Jan '25" format
export function shortDate(d: string): string {
  if (!d) return ''
  const parts = d.split('-')
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
  return `${months[parseInt(parts[1]) - 1]} '${parts[0].substring(2)}`
}

// "01/15" format
export function shortDateCompact(d: string): string {
  if (!d) return ''
  const parts = d.split('-')
  return `${parts[1]}/${parts[2]?.substring(0, 2)}`
}

export function shortMonth(d: string): string {
  if (!d) return ''
  const parts = d.split('-')
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
  return `${months[parseInt(parts[1]) - 1]} '${parts[0].substring(2)}`
}

export function avg(arr: number[]): number {
  return arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0
}

export function fmt(n: number | null | undefined, decimals = 0): string {
  if (n === null || n === undefined) return '--'
  if (n >= 1000000) return `${(n / 1000000).toFixed(1)}M`
  if (n >= 10000) return `${(n / 1000).toFixed(1)}k`
  return n.toFixed(decimals)
}
