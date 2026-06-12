import type { Locale } from './i18n'

const LOCAL_AI_BASE = (import.meta.env.VITE_LOCAL_AI_BASE as string | undefined) || 'http://127.0.0.1:8787'

export type AIChatMessage = {
  role: 'user' | 'assistant'
  content: string
}

export type LocalAIStatus = {
  available: boolean
  authenticated: boolean
  provider?: string
  model?: string
  accountId?: string
  expires?: number
  error?: string
}

export type AIProviderStatus =
  | { type: 'local'; status: LocalAIStatus }
  | { type: 'openrouter' }
  | { type: 'none'; local?: LocalAIStatus }

type LocalAIResponse = {
  provider: string
  model: string
  content: string
}

function timeoutSignal(ms: number): AbortSignal {
  const controller = new AbortController()
  window.setTimeout(() => controller.abort(), ms)
  return controller.signal
}

export async function getLocalAIStatus(timeoutMs = 700): Promise<LocalAIStatus> {
  try {
    const res = await fetch(`${LOCAL_AI_BASE}/api/ai/status`, {
      method: 'GET',
      signal: timeoutSignal(timeoutMs),
    })
    if (!res.ok) {
      return { available: false, authenticated: false, error: `Local AI status ${res.status}` }
    }
    return await res.json() as LocalAIStatus
  } catch {
    return { available: false, authenticated: false }
  }
}

export function isLocalAIReady(status: LocalAIStatus | null | undefined): status is LocalAIStatus {
  return !!status?.available && !!status.authenticated
}

export async function detectAIProvider(openRouterKey?: string): Promise<AIProviderStatus> {
  const local = await getLocalAIStatus()
  if (isLocalAIReady(local)) return { type: 'local', status: local }
  if (openRouterKey && openRouterKey.trim().length > 10) return { type: 'openrouter' }
  return { type: 'none', local }
}

async function postLocalAI(path: string, body: unknown): Promise<LocalAIResponse> {
  const res = await fetch(`${LOCAL_AI_BASE}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  const payload = await res.json().catch(() => ({})) as { error?: string } & Partial<LocalAIResponse>
  if (!res.ok) {
    throw new Error(payload.error || `Local AI error ${res.status}`)
  }
  if (!payload.content) {
    throw new Error('Local AI returned an empty response.')
  }
  return payload as LocalAIResponse
}

export async function fetchLocalAISummary(params: {
  locale: Locale
  title: string
  description?: string
  data: unknown[]
}): Promise<string> {
  const result = await postLocalAI('/api/ai/summary', params)
  return result.content
}

export async function fetchLocalAIChat(params: {
  systemPrompt: string
  messages: AIChatMessage[]
  maxTokens?: number
}): Promise<string> {
  const result = await postLocalAI('/api/ai/chat', params)
  return result.content
}

export async function fetchLocalAIChatStream(
  params: {
    systemPrompt: string
    messages: AIChatMessage[]
    maxTokens?: number
  },
  onDelta: (delta: string) => void,
): Promise<string> {
  const res = await fetch(`${LOCAL_AI_BASE}/api/ai/chat/stream`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(params),
  })
  if (!res.ok) {
    const payload = await res.json().catch(() => ({})) as { error?: string }
    throw new Error(payload.error || `Local AI error ${res.status}`)
  }
  if (!res.body) {
    throw new Error('Local AI returned an empty stream.')
  }

  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let fullText = ''

  const consumeLine = (line: string) => {
    if (!line.trim()) return
    const event = JSON.parse(line) as { type?: string; delta?: string; content?: string; error?: string }
    if (event.type === 'delta' && event.delta) {
      fullText += event.delta
      onDelta(event.delta)
      return
    }
    if (event.type === 'done') {
      if (event.content && fullText.length === 0) fullText = event.content
      return
    }
    if (event.type === 'error') {
      throw new Error(event.error || 'Local AI stream failed.')
    }
  }

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split('\n')
    buffer = lines.pop() ?? ''
    for (const line of lines) consumeLine(line)
  }
  if (buffer.trim()) consumeLine(buffer)
  return fullText
}
