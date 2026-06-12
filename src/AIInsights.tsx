import { useState, useMemo, useCallback, useEffect, useRef } from 'react'
import type { HealthData, DailyMetrics } from './types'
import { computeHealthScores, scoreLabel, type HealthScore } from './healthScore'
import { Sparkles, Key, Loader2, MessageCircle, Send, Download, Copy, Check, Database, X } from 'lucide-react'
import { useI18n, type Locale } from './i18n'
import { fetchLocalAIChat, fetchLocalAIChatStream, getLocalAIStatus, isLocalAIReady, type LocalAIStatus } from './aiClient'
import { buildInsightsSystemPrompt, localizeQuestion } from './aiPrompts'
import {
  buildHealthToolPlanningPrompt,
  buildToolResultsContext,
  parseHealthToolPlan,
  runHealthTool,
  toToolReference,
  type HealthToolCurrentView,
  type HealthToolReference,
} from './aiTools'

const CACHE_KEY = 'health_chat_cache'
const CACHE_TTL = 10 * 60 * 1000 // 10 minutes

const PREDEFINED_QUESTIONS = [
  { label: 'Overall health summary', question: 'Give me a comprehensive summary of my overall health based on all the data. What am I doing well? What needs improvement?' },
  { label: 'Sleep quality analysis', question: 'Analyze my sleep patterns in depth. How is my sleep quality, consistency, and stage breakdown? What is impacting my sleep and what can I do to improve it?' },
  { label: 'How does sleep affect my recovery?', question: 'Analyze the relationship between my sleep duration/quality and my next-day HRV, resting heart rate, and exercise performance. Show me the specific numbers.' },
  { label: 'Cardio fitness assessment', question: 'Assess my cardiovascular fitness based on VO2 Max, resting HR, HRV, and walking HR. How do I compare for my age? What should I focus on to improve?' },
  { label: 'Training optimization', question: 'Look at my workout patterns, types, frequency, and intensity. Am I training effectively? What changes would give me the most improvement?' },
  { label: 'What are my biggest health risks?', question: 'Based on my data trends, what are my biggest health risk factors? Are there any concerning patterns I should discuss with a doctor?' },
  { label: 'Week-over-week progress', question: 'Compare my last 7 days vs the previous 7 days across all metrics. What improved? What got worse? Am I trending in the right direction?' },
  { label: 'Exercise vs rest balance', question: 'Am I balancing exercise and recovery well? Look at my workout frequency, HRV trends, resting HR recovery, and sleep on training vs rest days.' },
]

function buildDataContext(data: HealthData, scores: HealthScore[], metrics: DailyMetrics[]): string {
  const recent30 = metrics.slice(-30)
  const prev30 = metrics.slice(-60, -30)
  const recent7 = metrics.slice(-7)
  const prev7 = metrics.slice(-14, -7)

  const avg = (arr: number[]) => arr.length ? Math.round(arr.reduce((a, b) => a + b, 0) / arr.length * 10) / 10 : null

  const r30 = {
    steps: avg(recent30.map(m => m.steps).filter(v => v > 0)),
    sleep: avg(recent30.filter(m => m.sleepHours && m.sleepHours > 0).map(m => m.sleepHours!)),
    rhr: avg(recent30.filter(m => m.restingHeartRate && m.restingHeartRate > 0).map(m => m.restingHeartRate!)),
    hrv: avg(recent30.filter(m => m.hrv && m.hrv > 0).map(m => m.hrv!)),
    exercise: avg(recent30.map(m => m.exerciseMinutes).filter(v => v > 0)),
    distance: avg(recent30.map(m => m.distance).filter(v => v > 0)),
  }
  const p30 = {
    steps: avg(prev30.map(m => m.steps).filter(v => v > 0)),
    sleep: avg(prev30.filter(m => m.sleepHours && m.sleepHours > 0).map(m => m.sleepHours!)),
    rhr: avg(prev30.filter(m => m.restingHeartRate && m.restingHeartRate > 0).map(m => m.restingHeartRate!)),
    hrv: avg(prev30.filter(m => m.hrv && m.hrv > 0).map(m => m.hrv!)),
    exercise: avg(prev30.map(m => m.exerciseMinutes).filter(v => v > 0)),
  }
  const r7 = {
    steps: avg(recent7.map(m => m.steps).filter(v => v > 0)),
    sleep: avg(recent7.filter(m => m.sleepHours && m.sleepHours > 0).map(m => m.sleepHours!)),
    rhr: avg(recent7.filter(m => m.restingHeartRate && m.restingHeartRate > 0).map(m => m.restingHeartRate!)),
    hrv: avg(recent7.filter(m => m.hrv && m.hrv > 0).map(m => m.hrv!)),
  }
  const p7 = {
    steps: avg(prev7.map(m => m.steps).filter(v => v > 0)),
    sleep: avg(prev7.filter(m => m.sleepHours && m.sleepHours > 0).map(m => m.sleepHours!)),
    rhr: avg(prev7.filter(m => m.restingHeartRate && m.restingHeartRate > 0).map(m => m.restingHeartRate!)),
    hrv: avg(prev7.filter(m => m.hrv && m.hrv > 0).map(m => m.hrv!)),
  }

  const sleepHrvPairs: { sleep: number; hrv: number }[] = []
  for (let i = 0; i < recent30.length - 1; i++) {
    const sleep = recent30[i].sleepHours
    const hrv = recent30[i + 1]?.hrv
    if (sleep && sleep > 0 && hrv && hrv > 0) sleepHrvPairs.push({ sleep, hrv })
  }
  const lowSleepHRV = sleepHrvPairs.filter(p => p.sleep < 7)
  const goodSleepHRV = sleepHrvPairs.filter(p => p.sleep >= 7)

  const cutoff30 = new Date(); cutoff30.setDate(cutoff30.getDate() - 30)
  const recentWorkouts = data.workouts.filter(w => w.date >= cutoff30.toISOString().substring(0, 10))
  const workoutTypes = new Map<string, { count: number; avgDur: number; avgHR: number | null }>()
  for (const w of recentWorkouts) {
    const e = workoutTypes.get(w.type) || { count: 0, avgDur: 0, avgHR: null }
    e.count++
    e.avgDur += w.duration
    if (w.hrAvg) e.avgHR = ((e.avgHR || 0) * (e.count - 1) + w.hrAvg) / e.count
    workoutTypes.set(w.type, e)
  }

  const vo2 = data.cardioRecords.filter(r => r.type === 'vo2max').sort((a, b) => b.date.localeCompare(a.date))
  const latestWeight = data.bodyRecords.filter(r => r.weight !== null).sort((a, b) => b.date.localeCompare(a.date))[0]
  const recentScores = scores.slice(-30)
  const avgScore = recentScores.length > 0 ? Math.round(recentScores.reduce((s, r) => s + r.total, 0) / recentScores.length) : null
  const age = data.profile.dob ? new Date().getFullYear() - new Date(data.profile.dob).getFullYear() : null

  return `## Profile
Age: ${age || 'unknown'}, Sex: ${data.profile.sex?.includes('Male') ? 'Male' : 'Female'}

## Last 7 Days (vs previous 7)
Steps: ${r7.steps}/day (was ${p7.steps}), Sleep: ${r7.sleep}h (was ${p7.sleep}), RHR: ${r7.rhr} bpm (was ${p7.rhr}), HRV: ${r7.hrv} ms (was ${p7.hrv})

## Last 30 Days (vs previous 30)
Steps: ${r30.steps}/day (was ${p30.steps}), Sleep: ${r30.sleep}h (was ${p30.sleep}), RHR: ${r30.rhr} bpm (was ${p30.rhr}), HRV: ${r30.hrv} ms (was ${p30.hrv}), Exercise: ${r30.exercise} min/day (was ${p30.exercise}), Distance: ${r30.distance} km/day

## Health Score: ${avgScore}/100 (${avgScore ? scoreLabel(avgScore).label : 'N/A'})

## Cardio
VO2 Max: ${vo2.length > 0 ? vo2[0].value.toFixed(1) : 'N/A'} mL/kg/min, Weight: ${latestWeight?.weight ? latestWeight.weight.toFixed(1) + ' kg' : 'N/A'}

## Sleep-HRV Relationship
HRV after <7h sleep: ${lowSleepHRV.length > 3 ? avg(lowSleepHRV.map(p => p.hrv)) : 'N/A'} ms (${lowSleepHRV.length} nights)
HRV after ≥7h sleep: ${goodSleepHRV.length > 3 ? avg(goodSleepHRV.map(p => p.hrv)) : 'N/A'} ms (${goodSleepHRV.length} nights)

## Workouts (last 30d): ${recentWorkouts.length} total
${Array.from(workoutTypes.entries()).map(([t, e]) => `${t}: ${e.count}x, avg ${Math.round(e.avgDur / e.count)}min${e.avgHR ? `, avg HR ${Math.round(e.avgHR)}bpm` : ''}`).join('\n')}

## Dataset: ${metrics.length} days, ${data.workouts.length} workouts, ${data.sleepRecords.length} sleep records`
}

interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
  followUps?: string[]
  toolRefs?: HealthToolReference[]
}

function parseAssistantOutput(text: string): { responseText: string; followUps: string[] } {
  const parts = text.split('FOLLOW_UPS:')
  return {
    responseText: parts[0].trim(),
    followUps: parts[1]
      ? parts[1].trim().split('|').map(f => f.trim()).filter(Boolean).slice(0, 3)
      : [],
  }
}

function formatChatMessage(message: ChatMessage): string {
  if (message.role === 'user') return `Q: ${message.content}`
  const refs = message.toolRefs && message.toolRefs.length > 0
    ? `\n\nData consulted:\n${message.toolRefs.map(ref => `- ${ref.label} (${ref.argsSummary || ref.name}): ${ref.summary}`).join('\n')}`
    : ''
  return `A: ${message.content}${refs}`
}

function buildCurrentViewContext(currentView: HealthToolCurrentView | undefined, locale: Locale): string {
  if (!currentView) return ''
  const label = currentView.label || currentView.tab
  if (locale === 'zh') {
    return `当前用户正在查看的仪表盘模块：
模块：${label} (${currentView.tab})
时间范围：${currentView.range || 'all'}
聚合粒度：${currentView.granularity || 'default'}
筛选起始日期：${currentView.cutoffDate || 'none'}

当用户的问题含义不明确时，请优先按当前模块理解；但仍然要基于工具返回的数据回答。`
  }
  return `Current dashboard view:
Module: ${label} (${currentView.tab})
Time range: ${currentView.range || 'all'}
Granularity: ${currentView.granularity || 'default'}
Cutoff date: ${currentView.cutoffDate || 'none'}

When the user's question is ambiguous, interpret it in the context of this module, while still grounding the answer in retrieved tool data.`
}

async function fetchOpenRouterChat(params: {
  apiKey: string
  systemPrompt: string
  messages: { role: 'user' | 'assistant'; content: string }[]
  maxTokens: number
}): Promise<string> {
  const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${params.apiKey}`,
    },
    body: JSON.stringify({
      model: 'anthropic/claude-sonnet-4.6',
      messages: [
        { role: 'system', content: params.systemPrompt },
        ...params.messages,
      ],
      max_tokens: params.maxTokens,
      stream: false,
    }),
  })

  if (!res.ok) {
    const body = await res.text()
    throw new Error(`API error ${res.status}: ${body.substring(0, 200)}`)
  }

  const body = await res.json() as { choices?: { message?: { content?: string } }[] }
  return body.choices?.[0]?.message?.content ?? ''
}

async function fetchOpenRouterChatStream(
  params: {
    apiKey: string
    systemPrompt: string
    messages: { role: 'user' | 'assistant'; content: string }[]
    maxTokens: number
  },
  onDelta: (delta: string) => void,
): Promise<string> {
  const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${params.apiKey}`,
    },
    body: JSON.stringify({
      model: 'anthropic/claude-sonnet-4.6',
      messages: [
        { role: 'system', content: params.systemPrompt },
        ...params.messages,
      ],
      max_tokens: params.maxTokens,
      stream: true,
    }),
  })

  if (!res.ok) {
    const body = await res.text()
    throw new Error(`API error ${res.status}: ${body.substring(0, 200)}`)
  }

  const reader = res.body?.getReader()
  const decoder = new TextDecoder()
  let fullText = ''

  if (reader) {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break

      const chunk = decoder.decode(value, { stream: true })
      const lines = chunk.split('\n').filter(l => l.startsWith('data: '))

      for (const line of lines) {
        const data = line.slice(6).trim()
        if (data === '[DONE]') continue
        try {
          const parsed = JSON.parse(data)
          const delta = parsed.choices?.[0]?.delta?.content
          if (delta) {
            fullText += delta
            onDelta(delta)
          }
        } catch {
          // Skip malformed stream chunks.
        }
      }
    }
  }

  return fullText
}

function DataReferences({ refs, locale }: { refs: HealthToolReference[]; locale: Locale }) {
  if (refs.length === 0) return null
  const title = locale === 'zh' ? '参考数据' : 'Data consulted'
  const rows = locale === 'zh' ? '行' : 'rows'
  return (
    <div className="mb-3 rounded-lg border border-zinc-800 bg-zinc-950/60 p-3">
      <div className="flex items-center gap-1.5 text-[11px] font-medium text-zinc-400 mb-2">
        <Database size={12} className="text-cyan-400" />
        {title}
      </div>
      <div className="space-y-2">
        {refs.map((ref, index) => (
          <div key={`${ref.name}-${index}`} className="rounded-md border border-zinc-800/70 bg-zinc-900/60 px-3 py-2">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="text-xs text-zinc-300 truncate">{ref.label}</div>
                {ref.argsSummary && <div className="text-[10px] text-zinc-600 mt-0.5 truncate">{ref.argsSummary}</div>}
              </div>
              <div className="shrink-0 text-[10px] text-zinc-600 tabular-nums">{ref.rowCount} {rows}</div>
            </div>
            <div className="text-[11px] text-zinc-500 mt-1 leading-relaxed">{ref.summary}</div>
            {ref.reason && <div className="text-[10px] text-zinc-600 mt-1 leading-relaxed">{ref.reason}</div>}
          </div>
        ))}
      </div>
    </div>
  )
}

// Cache helpers
function loadCache(): { messages: ChatMessage[]; timestamp: number } | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw)
    if (Date.now() - parsed.timestamp > CACHE_TTL) {
      localStorage.removeItem(CACHE_KEY)
      return null
    }
    return parsed
  } catch { return null }
}

function saveCache(messages: ChatMessage[]) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify({ messages, timestamp: Date.now() }))
  } catch { /* quota exceeded */ }
}

interface Props {
  data: HealthData
  metrics: DailyMetrics[]
  currentView?: HealthToolCurrentView
}

export default function AIInsights({ data, metrics, currentView }: Props) {
  const { tText, locale } = useI18n()
  const [open, setOpen] = useState(false)
  const [apiKey, setApiKey] = useState(() => sessionStorage.getItem('openrouter_key') || '')
  const [localAIStatus, setLocalAIStatus] = useState<LocalAIStatus | null>(null)
  const [messages, setMessages] = useState<ChatMessage[]>(() => loadCache()?.messages || [])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [customQ, setCustomQ] = useState('')
  const [streamText, setStreamText] = useState('')
  const [pendingToolRefs, setPendingToolRefs] = useState<HealthToolReference[]>([])
  const [loadingStage, setLoadingStage] = useState<'planning' | 'querying' | 'answering' | ''>('')
  const [copied, setCopied] = useState(false)
  const bottomRef = useRef<HTMLDivElement>(null)

  const scores = useMemo(() => computeHealthScores(data), [data])
  const dataContext = useMemo(() => buildDataContext(data, scores, metrics), [data, scores, metrics])
  const localReady = isLocalAIReady(localAIStatus)

  useEffect(() => {
    let cancelled = false
    const check = () => {
      getLocalAIStatus(1000).then(status => {
        if (!cancelled) setLocalAIStatus(status)
      })
    }
    check()
    const interval = window.setInterval(check, 5000)
    window.addEventListener('focus', check)
    return () => {
      cancelled = true
      window.clearInterval(interval)
      window.removeEventListener('focus', check)
    }
  }, [])

  // Save to cache whenever messages change
  useEffect(() => {
    if (messages.length > 0) saveCache(messages)
  }, [messages])

  // Auto-scroll to bottom
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, streamText, pendingToolRefs, loadingStage])

  const saveKey = useCallback((key: string) => {
    setApiKey(key)
    if (key) sessionStorage.setItem('openrouter_key', key)
  }, [])

  const ask = useCallback(async (question: string) => {
    if ((!localReady && !apiKey) || loading) return
    setLoading(true)
    setLoadingStage('planning')
    setError('')
    setStreamText('')
    setPendingToolRefs([])

    const newMessages: ChatMessage[] = [...messages, { role: 'user', content: question }]
    setMessages(newMessages)

    try {
      const planningPrompt = buildHealthToolPlanningPrompt(locale, data, metrics, currentView)
      const planningMessages = newMessages
        .slice(-8)
        .map(m => ({ role: m.role, content: m.content }))
      const planningText = localReady
        ? await fetchLocalAIChat({
          systemPrompt: planningPrompt,
          messages: planningMessages,
          maxTokens: 900,
        })
        : await fetchOpenRouterChat({
          apiKey,
          systemPrompt: planningPrompt,
          messages: planningMessages,
          maxTokens: 900,
        })
      const toolCalls = parseHealthToolPlan(planningText)
      setLoadingStage('querying')
      const toolResults = toolCalls.map(call => runHealthTool(call, data, metrics))
      const toolRefs = toolResults.map(toToolReference)
      setPendingToolRefs(toolRefs)
      setLoadingStage('answering')

      const toolContext = buildToolResultsContext(toolResults, locale)
      const viewContext = buildCurrentViewContext(currentView, locale)
      const systemPrompt = [buildInsightsSystemPrompt(locale, dataContext), viewContext, toolContext]
        .filter(Boolean)
        .join('\n\n')
      const answerMessages = newMessages.map(m => ({ role: m.role as 'user' | 'assistant', content: m.content }))

      if (localReady) {
        let fullText = ''
        fullText = await fetchLocalAIChatStream(
          {
            systemPrompt,
            messages: answerMessages,
            maxTokens: 1500,
          },
          delta => {
            fullText += delta
            const displayText = fullText.split('FOLLOW_UPS:')[0].trim()
            setStreamText(displayText)
          },
        )
        const { responseText, followUps } = parseAssistantOutput(fullText)

        setMessages([...newMessages, { role: 'assistant', content: responseText, followUps, toolRefs }])
        return
      }

      let streamedText = ''
      const fullText = await fetchOpenRouterChatStream(
        {
          apiKey,
          systemPrompt,
          messages: answerMessages,
          maxTokens: 1500,
        },
        delta => {
          streamedText += delta
          setStreamText(streamedText.split('FOLLOW_UPS:')[0].trim())
        },
      )
      const { responseText, followUps } = parseAssistantOutput(fullText)

      setStreamText('')
      setMessages([...newMessages, { role: 'assistant', content: responseText, followUps, toolRefs }])
    } catch (err) {
      setError(String(err))
      setMessages(newMessages.slice(0, -1))
    } finally {
      setLoading(false)
      setLoadingStage('')
      setStreamText('')
      setPendingToolRefs([])
    }
  }, [apiKey, locale, localReady, loading, messages, dataContext, data, metrics, currentView])

  const handleCustomSubmit = () => {
    if (customQ.trim()) {
      ask(customQ.trim())
      setCustomQ('')
    }
  }

  const exportChat = useCallback(() => {
    const text = messages.map(formatChatMessage).join('\n\n---\n\n')
    const blob = new Blob([`Health Insights Chat\n${new Date().toLocaleDateString()}\n\n${text}`], { type: 'text/plain' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `health-insights-${new Date().toISOString().substring(0, 10)}.txt`
    a.click()
    URL.revokeObjectURL(url)
  }, [messages])

  const copyChat = useCallback(() => {
    const text = messages.map(formatChatMessage).join('\n\n---\n\n')
    navigator.clipboard.writeText(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }, [messages])

  const hasKey = localReady || apiKey.length > 10

  // Get last assistant message's follow-ups
  const lastFollowUps = messages.length > 0 && messages[messages.length - 1].role === 'assistant'
    ? messages[messages.length - 1].followUps || []
    : []
  const loadingText = loadingStage === 'planning'
    ? (locale === 'zh' ? '判断需要查询哪些本地数据...' : 'Planning local data lookups...')
    : loadingStage === 'querying'
      ? (locale === 'zh' ? '正在查询本地健康数据...' : 'Querying local health data...')
      : loadingStage === 'answering'
        ? (locale === 'zh' ? '基于参考数据生成回答...' : 'Answering with retrieved data...')
        : tText('Analyzing your data...')
  const assistantTitle = locale === 'zh' ? 'AI 健康助理' : 'AI Health Assistant'
  const viewLabel = currentView?.label || currentView?.tab || (locale === 'zh' ? '总览' : 'Overview')
  const providerLabel = localReady ? (localAIStatus?.model || 'ChatGPT') : 'OpenRouter'

  return (
    <>
      {!open && (
        <button
          onClick={() => setOpen(true)}
          aria-label={assistantTitle}
          title={assistantTitle}
          className="fixed bottom-4 right-4 z-[130] flex h-14 w-14 items-center justify-center rounded-full bg-[#0099FF] text-white shadow-2xl shadow-black/40 transition-transform hover:scale-105 focus:outline-none focus:ring-2 focus:ring-[#0099FF]/60 focus:ring-offset-2 focus:ring-offset-zinc-950"
        >
          {loading ? <Loader2 size={22} className="animate-spin" /> : <Sparkles size={22} />}
        </button>
      )}

      {open && (
        <div
          className="fixed inset-x-3 bottom-3 z-[130] sm:left-auto sm:right-4 sm:bottom-4 sm:w-[420px]"
          style={{ height: 'min(680px, calc(100vh - 88px))' }}
        >
          <div className="flex h-full min-h-0 flex-col overflow-hidden rounded-2xl border border-zinc-800 bg-zinc-950 shadow-2xl shadow-black/50">
            <div className="flex items-center justify-between gap-3 border-b border-zinc-800 px-4 py-3">
              <div className="flex min-w-0 items-center gap-3">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#0099FF]/15 text-[#0099FF]">
                  <Sparkles size={17} />
                </div>
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium text-zinc-100">{assistantTitle}</div>
                  <div className="truncate text-[11px] text-zinc-500">{viewLabel} · {providerLabel}</div>
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-1">
                {messages.length > 0 && (
                  <>
                    <button
                      onClick={copyChat}
                      aria-label={copied ? tText('Copied') : tText('Copy')}
                      title={copied ? tText('Copied') : tText('Copy')}
                      className="flex h-8 w-8 items-center justify-center rounded-lg text-zinc-500 transition-colors hover:bg-zinc-900 hover:text-zinc-200"
                    >
                      {copied ? <Check size={14} className="text-green-400" /> : <Copy size={14} />}
                    </button>
                    <button
                      onClick={exportChat}
                      aria-label={tText('Export')}
                      title={tText('Export')}
                      className="flex h-8 w-8 items-center justify-center rounded-lg text-zinc-500 transition-colors hover:bg-zinc-900 hover:text-zinc-200"
                    >
                      <Download size={14} />
                    </button>
                  </>
                )}
                <button
                  onClick={() => setOpen(false)}
                  aria-label={tText('Close')}
                  title={tText('Close')}
                  className="flex h-8 w-8 items-center justify-center rounded-lg text-zinc-500 transition-colors hover:bg-zinc-900 hover:text-zinc-200"
                >
                  <X size={15} />
                </button>
              </div>
            </div>

            <div className="border-b border-zinc-800 px-4 py-3">
              <div className="mb-2 flex items-center gap-1.5 text-[11px] font-medium text-zinc-400">
                <Key size={13} className="text-zinc-500" />
                <span className="truncate">{localReady ? tText('Local ChatGPT OAuth') : tText('OpenRouter API Key')}</span>
              </div>
              {localReady ? (
                <div className="rounded-lg border border-green-500/20 bg-green-500/10 px-3 py-2 text-xs text-green-300">
                  {tText('Connected to local ChatGPT OAuth server')}
                  {localAIStatus?.model && <span className="text-green-500"> · {localAIStatus.model}</span>}
                </div>
              ) : (
                <>
                  <input
                    type="password"
                    value={apiKey}
                    onChange={e => saveKey(e.target.value)}
                    placeholder="sk-or-..."
                    className="w-full rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 placeholder-zinc-600 focus:border-zinc-600 focus:outline-none"
                  />
                  <p className="mt-2 text-[10px] text-zinc-600">{tText('Stored in session memory only. Chat cached for 10 min.')}</p>
                </>
              )}
            </div>

            <div className="flex-1 space-y-3 overflow-y-auto px-4 py-4">
              {error && (
                <div className="rounded-lg border border-red-900/40 bg-red-950/30 px-3 py-2 text-sm text-red-400">{error}</div>
              )}

              {hasKey && messages.length === 0 && !loading && (
                <div>
                  <h3 className="mb-3 text-sm font-medium text-zinc-400">{tText('Ask about your health data')}</h3>
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                    {PREDEFINED_QUESTIONS.map(q => (
                      <button
                        key={q.label}
                        onClick={() => ask(localizeQuestion(q.question, locale))}
                        className="min-h-[86px] rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-3 text-left text-xs leading-relaxed text-zinc-300 transition-colors hover:border-zinc-700 hover:bg-zinc-800"
                      >
                        <MessageCircle size={14} className="mb-1.5 text-[#0099FF]" />
                        {tText(q.label)}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {messages.map((m, i) => (
                <div key={i} className={`rounded-xl px-4 py-3 ${
                  m.role === 'user'
                    ? 'ml-10 border border-[#0099FF]/20 bg-[#0099FF]/10'
                    : 'border border-zinc-800 bg-zinc-900'
                }`}>
                  {m.role === 'assistant' && (
                    <div className="mb-2 flex items-center gap-1.5">
                      <Sparkles size={12} className="text-[#0099FF]" />
                      <span className="text-[11px] text-[#0099FF]">{localReady ? 'ChatGPT' : 'Claude'}</span>
                    </div>
                  )}
                  <div className={`whitespace-pre-wrap text-sm leading-relaxed ${
                    m.role === 'user' ? 'text-zinc-200' : 'text-zinc-300'
                  }`}>
                    {m.role === 'assistant' && m.toolRefs && m.toolRefs.length > 0 && (
                      <DataReferences refs={m.toolRefs} locale={locale} />
                    )}
                    {m.content}
                  </div>
                </div>
              ))}

              {streamText && (
                <div className="rounded-xl border border-zinc-800 bg-zinc-900 px-4 py-3">
                  <div className="mb-2 flex items-center gap-1.5">
                    <Sparkles size={12} className="text-[#0099FF]" />
                    <span className="text-[11px] text-[#0099FF]">{localReady ? 'ChatGPT' : 'Claude'}</span>
                  </div>
                  {pendingToolRefs.length > 0 && <DataReferences refs={pendingToolRefs} locale={locale} />}
                  <div className="whitespace-pre-wrap text-sm leading-relaxed text-zinc-300">
                    {streamText}
                    <span className="ml-0.5 inline-block h-4 w-1.5 animate-pulse bg-[#0099FF]" />
                  </div>
                </div>
              )}

              {loading && !streamText && (
                <div className="rounded-xl border border-zinc-800 bg-zinc-900 px-4 py-3">
                  <div className="flex items-center gap-2">
                    <Loader2 size={14} className="animate-spin text-[#0099FF]" />
                    <span className="text-sm text-zinc-500">{loadingText}</span>
                  </div>
                  {pendingToolRefs.length > 0 && (
                    <div className="mt-3">
                      <DataReferences refs={pendingToolRefs} locale={locale} />
                    </div>
                  )}
                </div>
              )}

              {!hasKey && (
                <div className="py-10 text-center">
                  <Sparkles size={34} className="mx-auto mb-4 text-zinc-700" />
                  <div className="text-sm text-zinc-400">{tText('Start the local AI server or enter your OpenRouter API key above')}</div>
                  <div className="mt-1 text-xs text-zinc-600">{tText('Run npm run ai:login and npm run ai:server to use ChatGPT OAuth locally')}</div>
                </div>
              )}

              <div ref={bottomRef} />
            </div>

            <div className="border-t border-zinc-800 px-4 py-3">
              {hasKey && lastFollowUps.length > 0 && !loading && (
                <div className="mb-2 flex flex-wrap gap-2">
                  {lastFollowUps.map(q => (
                    <button
                      key={q}
                      onClick={() => ask(q)}
                      className="rounded-lg border border-zinc-800 bg-zinc-900 px-2.5 py-1.5 text-xs text-zinc-400 transition-colors hover:border-zinc-700 hover:text-zinc-200"
                    >
                      {q}
                    </button>
                  ))}
                </div>
              )}

              {hasKey && (
                <div className="flex gap-2">
                  <input
                    value={customQ}
                    onChange={e => setCustomQ(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && handleCustomSubmit()}
                    placeholder={locale === 'zh' ? `询问${viewLabel}相关问题...` : `Ask about ${viewLabel}...`}
                    disabled={loading}
                    className="min-w-0 flex-1 rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 placeholder-zinc-600 focus:border-zinc-600 focus:outline-none"
                  />
                  <button
                    onClick={handleCustomSubmit}
                    disabled={loading || !customQ.trim()}
                    aria-label={locale === 'zh' ? '发送' : 'Send'}
                    className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg transition-colors ${
                      loading || !customQ.trim()
                        ? 'bg-zinc-900 text-zinc-700'
                        : 'bg-[#0099FF] text-white hover:bg-[#168fe0]'
                    }`}
                  >
                    <Send size={15} />
                  </button>
                </div>
              )}

              {messages.length > 0 && !loading && (
                <button
                  onClick={() => { setMessages([]); setPendingToolRefs([]); localStorage.removeItem(CACHE_KEY) }}
                  className="mt-2 text-xs text-zinc-600 transition-colors hover:text-zinc-400"
                >
                  {tText('Start new conversation')}
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  )
}
