#!/usr/bin/env node
import { createServer } from 'node:http'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { homedir, platform, release, arch } from 'node:os'
import path from 'node:path'
import { randomUUID } from 'node:crypto'

const AUTH_BASE_URL = 'https://auth.openai.com'
const CODEX_BASE_URL = 'https://chatgpt.com/backend-api'
const CLIENT_ID = 'app_EMoamEEZ73f0CkXaXp7hrann'
const DEVICE_CALLBACK_URL = `${AUTH_BASE_URL}/deviceauth/callback`
const DEVICE_CODE_TIMEOUT_MS = 15 * 60_000
const DEFAULT_DEVICE_POLL_MS = 5_000
const TOKEN_REFRESH_SKEW_MS = 60_000
const DEFAULT_PORT = 8787
const DEFAULT_MODEL = 'gpt-5.5'
const STATE_DIR = path.join(homedir(), '.health-dashboard')
const AUTH_PATH = path.join(STATE_DIR, 'ai-auth.json')

function usage() {
  console.log(`Usage:
  npm run ai:login          Sign in with ChatGPT/Codex OAuth
  npm run ai:status         Show local AI auth status
  npm run ai:server         Start local AI API server

Environment:
  HEALTH_DASHBOARD_AI_PORT   Local server port, default ${DEFAULT_PORT}
  HEALTH_DASHBOARD_AI_MODEL  ChatGPT/Codex model, default ${DEFAULT_MODEL}
`)
}

function userAgent() {
  return `health-dashboard (${platform()} ${release()}; ${arch()})`
}

function headers(contentType) {
  return {
    'content-type': contentType,
    originator: 'health-dashboard',
    'user-agent': userAgent(),
  }
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

function parseJsonObject(text) {
  try {
    const parsed = JSON.parse(text)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null
  } catch {
    return null
  }
}

function trimString(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function decodeJwtPayload(token) {
  const parts = token.split('.')
  if (parts.length !== 3) return null
  try {
    return JSON.parse(Buffer.from(parts[1] ?? '', 'base64url').toString('utf8'))
  } catch {
    return null
  }
}

function resolveAccountId(accessToken) {
  const payload = decodeJwtPayload(accessToken)
  const auth = payload?.['https://api.openai.com/auth']
  return trimString(auth?.chatgpt_account_id)
}

function resolveExpiresAt(accessToken, expiresIn) {
  if (typeof expiresIn === 'number' && Number.isFinite(expiresIn) && expiresIn > 0) {
    return Date.now() + Math.trunc(expiresIn) * 1000
  }
  const exp = decodeJwtPayload(accessToken)?.exp
  if (typeof exp === 'number' && Number.isFinite(exp) && exp > 0) {
    return Math.trunc(exp) * 1000
  }
  return Date.now()
}

async function readAuth() {
  if (!existsSync(AUTH_PATH)) return null
  const raw = await readFile(AUTH_PATH, 'utf8')
  const auth = JSON.parse(raw)
  if (!auth || typeof auth !== 'object') return null
  if (typeof auth.access !== 'string' || typeof auth.refresh !== 'string') return null
  return auth
}

async function writeAuth(auth) {
  await mkdir(STATE_DIR, { recursive: true, mode: 0o700 })
  await writeFile(AUTH_PATH, `${JSON.stringify(auth, null, 2)}\n`, { mode: 0o600 })
}

function formatHttpError(prefix, response, bodyText) {
  const body = parseJsonObject(bodyText)
  const error = trimString(body?.error)
  const description = trimString(body?.error_description)
  const message = trimString(body?.message)
  const detail = [error, description, message].filter(Boolean).join(' ')
  return detail
    ? `${prefix}: HTTP ${response.status} ${detail}`
    : `${prefix}: HTTP ${response.status} ${bodyText || response.statusText}`
}

async function requestDeviceCode() {
  const response = await fetch(`${AUTH_BASE_URL}/api/accounts/deviceauth/usercode`, {
    method: 'POST',
    headers: headers('application/json'),
    body: JSON.stringify({ client_id: CLIENT_ID }),
  })
  const text = await response.text()
  if (!response.ok) throw new Error(formatHttpError('OpenAI device code request failed', response, text))
  const body = parseJsonObject(text)
  const deviceAuthId = trimString(body?.device_auth_id)
  const userCode = trimString(body?.user_code) ?? trimString(body?.usercode)
  const intervalSeconds = typeof body?.interval === 'number' && body.interval > 0 ? body.interval : undefined
  if (!deviceAuthId || !userCode) {
    throw new Error('OpenAI device code response was missing device_auth_id or user_code.')
  }
  return {
    deviceAuthId,
    userCode,
    verificationUrl: `${AUTH_BASE_URL}/codex/device`,
    intervalMs: intervalSeconds ? Math.max(1000, intervalSeconds * 1000) : DEFAULT_DEVICE_POLL_MS,
  }
}

async function pollDeviceAuthorization(device) {
  const deadline = Date.now() + DEVICE_CODE_TIMEOUT_MS
  while (Date.now() < deadline) {
    const response = await fetch(`${AUTH_BASE_URL}/api/accounts/deviceauth/token`, {
      method: 'POST',
      headers: headers('application/json'),
      body: JSON.stringify({
        device_auth_id: device.deviceAuthId,
        user_code: device.userCode,
      }),
    })
    const text = await response.text()
    if (response.ok) {
      const body = parseJsonObject(text)
      const authorizationCode = trimString(body?.authorization_code)
      const codeVerifier = trimString(body?.code_verifier)
      if (!authorizationCode || !codeVerifier) {
        throw new Error('OpenAI device authorization response was missing authorization_code or code_verifier.')
      }
      return { authorizationCode, codeVerifier }
    }
    if (response.status === 403 || response.status === 404) {
      await sleep(Math.min(device.intervalMs, Math.max(1000, deadline - Date.now())))
      continue
    }
    throw new Error(formatHttpError('OpenAI device authorization failed', response, text))
  }
  throw new Error('OpenAI device authorization timed out after 15 minutes.')
}

async function exchangeAuthorizationCode(authorizationCode, codeVerifier) {
  const response = await fetch(`${AUTH_BASE_URL}/oauth/token`, {
    method: 'POST',
    headers: headers('application/x-www-form-urlencoded'),
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code: authorizationCode,
      redirect_uri: DEVICE_CALLBACK_URL,
      client_id: CLIENT_ID,
      code_verifier: codeVerifier,
    }),
  })
  const text = await response.text()
  if (!response.ok) throw new Error(formatHttpError('OpenAI token exchange failed', response, text))
  const body = parseJsonObject(text)
  const access = trimString(body?.access_token)
  const refresh = trimString(body?.refresh_token)
  if (!access || !refresh) {
    throw new Error('OpenAI token exchange succeeded but did not return OAuth tokens.')
  }
  const accountId = resolveAccountId(access)
  if (!accountId) {
    throw new Error('Failed to extract ChatGPT account id from OAuth token.')
  }
  return {
    provider: 'chatgpt-oauth',
    access,
    refresh,
    expires: resolveExpiresAt(access, body?.expires_in),
    accountId,
    updatedAt: Date.now(),
  }
}

async function refreshAuth(auth) {
  const response = await fetch(`${AUTH_BASE_URL}/oauth/token`, {
    method: 'POST',
    headers: headers('application/x-www-form-urlencoded'),
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: auth.refresh,
      client_id: CLIENT_ID,
    }),
  })
  const text = await response.text()
  if (!response.ok) throw new Error(formatHttpError('OpenAI token refresh failed', response, text))
  const body = parseJsonObject(text)
  const access = trimString(body?.access_token)
  const refresh = trimString(body?.refresh_token)
  if (!access || !refresh) {
    throw new Error('OpenAI token refresh succeeded but did not return OAuth tokens.')
  }
  const accountId = resolveAccountId(access)
  if (!accountId) {
    throw new Error('Failed to extract ChatGPT account id from refreshed OAuth token.')
  }
  const nextAuth = {
    ...auth,
    access,
    refresh,
    expires: resolveExpiresAt(access, body?.expires_in),
    accountId,
    updatedAt: Date.now(),
  }
  await writeAuth(nextAuth)
  return nextAuth
}

async function requireFreshAuth() {
  const auth = await readAuth()
  if (!auth) {
    throw new Error('ChatGPT OAuth is not configured. Run npm run ai:login first.')
  }
  if (Date.now() + TOKEN_REFRESH_SKEW_MS >= Number(auth.expires || 0)) {
    return await refreshAuth(auth)
  }
  return auth
}

async function login() {
  console.log('Requesting ChatGPT/Codex device code...')
  const device = await requestDeviceCode()
  console.log('')
  console.log('Open this URL in your browser and enter the code:')
  console.log(`  ${device.verificationUrl}`)
  console.log('')
  console.log(`Code: ${device.userCode}`)
  console.log('')
  console.log('Waiting for authorization...')
  const authorization = await pollDeviceAuthorization(device)
  console.log('Exchanging authorization code...')
  const auth = await exchangeAuthorizationCode(authorization.authorizationCode, authorization.codeVerifier)
  await writeAuth(auth)
  console.log(`Signed in. Auth saved to ${AUTH_PATH}`)
}

function sampleData(data, maxPoints = 60) {
  if (!Array.isArray(data) || data.length <= maxPoints) return Array.isArray(data) ? data : []
  const step = Math.ceil(data.length / maxPoints)
  return data.filter((_, i) => i % step === 0)
}

function summaryPrompt({ locale, title, description, data }) {
  const sampled = sampleData(data)
  const isZh = locale === 'zh'
  const sampledLabel = Array.isArray(data) && data.length > 60
    ? (isZh ? '，已抽样' : ', sampled')
    : ''
  if (isZh) {
    return `你是一位友好、务实的健康教练，正在直接和用户讨论 TA 的个人健康数据。请使用中文回答，用“你/你的”来称呼用户。语气温和但具体，要引用数据中的数字，给出可执行建议。请控制在 3-5 句话内。指出表现不错的地方、值得关注的信号，并给出一个具体行动建议。

图表：“${title}”${description ? `\n说明：${description}` : ''}
用户数据（${Array.isArray(data) ? data.length : 0} 个点${sampledLabel}）：
${JSON.stringify(sampled, null, 0)}`
  }

  return `You're a friendly health coach talking directly to the user about their personal health data. Speak in second person ("your", "you've", "you're"). Be warm, specific with numbers, and actionable. Keep it to 3-5 sentences. Highlight what's going well, flag anything worth watching, and suggest one concrete thing they could do.

Chart: "${title}"${description ? `\nDescription: ${description}` : ''}
Their data (${Array.isArray(data) ? data.length : 0} points${sampledLabel}):
${JSON.stringify(sampled, null, 0)}`
}

function responseInput(messages) {
  return messages
    .filter(message => message && (message.role === 'user' || message.role === 'assistant') && typeof message.content === 'string')
    .map(message => ({
      role: message.role,
      content: [{
        type: message.role === 'assistant' ? 'output_text' : 'input_text',
        text: message.content,
      }],
    }))
}

function buildCodexBody({ model, systemPrompt, messages }) {
  return {
    model: model || process.env.HEALTH_DASHBOARD_AI_MODEL || DEFAULT_MODEL,
    store: false,
    stream: true,
    instructions: systemPrompt || 'You are a helpful assistant.',
    input: responseInput(messages),
    text: { verbosity: 'low' },
    // Do not request textual reasoning summaries. Only final answer text is user-facing.
    reasoning: { effort: 'medium' },
    include: ['reasoning.encrypted_content'],
    parallel_tool_calls: false,
  }
}

function isReasoningEvent(event) {
  if (!event || typeof event !== 'object') return false
  const values = [
    event.type,
    event.item?.type,
    event.output?.type,
    event.content?.type,
    event.delta?.type,
    event.part?.type,
  ].filter(value => typeof value === 'string')
  return values.some(value => /reasoning|thought|chain_of_thought|encrypted_content/i.test(value))
}

function extractTextFromEvent(event, state) {
  if (!event || typeof event !== 'object') return ''
  if (isReasoningEvent(event)) return ''
  if (event.type === 'response.output_text.delta' && typeof event.delta === 'string') {
    return event.delta
  }
  if (event.type === 'response.completed' && event.response && state.text.length === 0) {
    return extractTextFromResponse(event.response)
  }
  if (typeof event.delta === 'string' && /(^|\.)output_text\.delta$/i.test(String(event.type ?? ''))) {
    return event.delta
  }
  return ''
}

function extractTextFromResponse(response) {
  const parts = []
  for (const item of response?.output ?? []) {
    if (item?.type && item.type !== 'message') continue
    for (const content of item?.content ?? []) {
      if (content?.type && content.type !== 'output_text' && content.type !== 'text') continue
      if (typeof content?.text === 'string') parts.push(content.text)
    }
  }
  return parts.join('')
}

async function readCodexSSE(response, onDelta) {
  const reader = response.body?.getReader()
  if (!reader) throw new Error('No response body from ChatGPT/Codex backend.')
  const decoder = new TextDecoder()
  const state = { text: '' }
  let buffer = ''

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const blocks = buffer.split(/\n\n/)
    buffer = blocks.pop() ?? ''

    for (const block of blocks) {
      const dataLines = block
        .split('\n')
        .filter(line => line.startsWith('data:'))
        .map(line => line.slice(5).trim())
      for (const data of dataLines) {
        if (!data || data === '[DONE]') continue
        try {
          const event = JSON.parse(data)
          const delta = extractTextFromEvent(event, state)
          if (delta) {
            state.text += delta
            onDelta?.(delta)
          }
        } catch {
          // Ignore non-JSON SSE comments.
        }
      }
    }
  }

  if (buffer.trim()) {
    for (const line of buffer.split('\n')) {
      if (!line.startsWith('data:')) continue
      const data = line.slice(5).trim()
      if (!data || data === '[DONE]') continue
      try {
        const event = JSON.parse(data)
        const delta = extractTextFromEvent(event, state)
        if (delta) {
          state.text += delta
          onDelta?.(delta)
        }
      } catch {
        // Ignore malformed final chunks.
      }
    }
  }

  return state.text.trim()
}

async function codexResponses({ messages, systemPrompt, model, maxTokens, onDelta }) {
  const auth = await requireFreshAuth()
  const requestId = randomUUID()
  const response = await fetch(`${CODEX_BASE_URL}/codex/responses`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${auth.access}`,
      'chatgpt-account-id': auth.accountId,
      originator: 'health-dashboard',
      'user-agent': userAgent(),
      'openai-beta': 'responses=experimental',
      accept: 'text/event-stream',
      'content-type': 'application/json',
      session_id: requestId,
      'x-client-request-id': requestId,
    },
    body: JSON.stringify(buildCodexBody({ model, systemPrompt, messages, maxTokens })),
  })

  if (!response.ok) {
    const text = await response.text().catch(() => '')
    throw new Error(formatCodexError(response.status, text))
  }

  const content = await readCodexSSE(response, onDelta)
  if (!content) {
    throw new Error('ChatGPT/Codex returned an empty response.')
  }
  return {
    provider: 'chatgpt-oauth',
    model: model || process.env.HEALTH_DASHBOARD_AI_MODEL || DEFAULT_MODEL,
    content,
  }
}

function formatCodexError(status, text) {
  const body = parseJsonObject(text)
  const err = body?.error && typeof body.error === 'object' ? body.error : body
  const code = trimString(err?.code) ?? trimString(err?.type)
  if (status === 401) return 'ChatGPT OAuth expired or was revoked. Run npm run ai:login again.'
  if (status === 429 || /usage_limit|rate_limit/i.test(code ?? '')) {
    const plan = trimString(err?.plan_type)
    const resetsAt = typeof err?.resets_at === 'number' ? err.resets_at * 1000 : undefined
    const mins = resetsAt ? Math.max(0, Math.round((resetsAt - Date.now()) / 60000)) : undefined
    return `You have hit your ChatGPT usage limit${plan ? ` (${plan})` : ''}.${mins !== undefined ? ` Try again in ~${mins} min.` : ''}`
  }
  return trimString(err?.message) ?? `ChatGPT/Codex API error ${status}: ${text.slice(0, 300)}`
}

async function readJsonRequest(req) {
  const chunks = []
  let size = 0
  for await (const chunk of req) {
    size += chunk.length
    if (size > 10 * 1024 * 1024) throw new Error('Request body is too large.')
    chunks.push(chunk)
  }
  const raw = Buffer.concat(chunks).toString('utf8')
  return raw ? JSON.parse(raw) : {}
}

function isAllowedOrigin(origin) {
  if (!origin) return true
  try {
    const url = new URL(origin)
    return url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
  } catch {
    return false
  }
}

function sendJson(req, res, status, body) {
  const origin = req.headers.origin
  if (isAllowedOrigin(origin)) {
    res.setHeader('access-control-allow-origin', origin || '*')
  }
  res.setHeader('vary', 'Origin')
  res.setHeader('content-type', 'application/json; charset=utf-8')
  res.statusCode = status
  res.end(JSON.stringify(body))
}

function sendStreamHeaders(req, res) {
  const origin = req.headers.origin
  if (isAllowedOrigin(origin)) {
    res.setHeader('access-control-allow-origin', origin || '*')
  }
  res.setHeader('vary', 'Origin')
  res.setHeader('content-type', 'application/x-ndjson; charset=utf-8')
  res.setHeader('cache-control', 'no-cache, no-transform')
  res.setHeader('x-accel-buffering', 'no')
  res.statusCode = 200
  res.flushHeaders?.()
}

function writeStreamEvent(res, event) {
  res.write(`${JSON.stringify(event)}\n`)
}

function sendCors(req, res) {
  const origin = req.headers.origin
  if (isAllowedOrigin(origin)) {
    res.setHeader('access-control-allow-origin', origin || '*')
    res.setHeader('access-control-allow-methods', 'GET, POST, OPTIONS')
    res.setHeader('access-control-allow-headers', 'content-type')
    res.setHeader('access-control-max-age', '86400')
    res.statusCode = 204
    res.end()
    return
  }
  res.statusCode = 403
  res.end()
}

async function statusPayload() {
  const auth = await readAuth()
  if (!auth) {
    return { available: true, authenticated: false, provider: 'chatgpt-oauth', model: process.env.HEALTH_DASHBOARD_AI_MODEL || DEFAULT_MODEL }
  }
  return {
    available: true,
    authenticated: true,
    provider: 'chatgpt-oauth',
    model: process.env.HEALTH_DASHBOARD_AI_MODEL || DEFAULT_MODEL,
    accountId: auth.accountId,
    expires: auth.expires,
  }
}

async function handleRequest(req, res) {
  if (req.method === 'OPTIONS') {
    sendCors(req, res)
    return
  }
  if (!isAllowedOrigin(req.headers.origin)) {
    sendJson(req, res, 403, { error: 'Only localhost origins can call this server.' })
    return
  }

  const url = new URL(req.url || '/', 'http://127.0.0.1')
  try {
    if (req.method === 'GET' && url.pathname === '/api/ai/status') {
      sendJson(req, res, 200, await statusPayload())
      return
    }
    if (req.method === 'POST' && url.pathname === '/api/ai/chat') {
      const body = await readJsonRequest(req)
      const result = await codexResponses({
        messages: Array.isArray(body.messages) ? body.messages : [],
        systemPrompt: typeof body.systemPrompt === 'string' ? body.systemPrompt : undefined,
        model: typeof body.model === 'string' ? body.model : undefined,
        maxTokens: body.maxTokens,
      })
      sendJson(req, res, 200, result)
      return
    }
    if (req.method === 'POST' && url.pathname === '/api/ai/chat/stream') {
      const body = await readJsonRequest(req)
      sendStreamHeaders(req, res)
      writeStreamEvent(res, {
        type: 'start',
        provider: 'chatgpt-oauth',
        model: typeof body.model === 'string' ? body.model : process.env.HEALTH_DASHBOARD_AI_MODEL || DEFAULT_MODEL,
      })
      try {
        const result = await codexResponses({
          messages: Array.isArray(body.messages) ? body.messages : [],
          systemPrompt: typeof body.systemPrompt === 'string' ? body.systemPrompt : undefined,
          model: typeof body.model === 'string' ? body.model : undefined,
          maxTokens: body.maxTokens,
          onDelta: delta => writeStreamEvent(res, { type: 'delta', delta }),
        })
        writeStreamEvent(res, { type: 'done', content: result.content })
      } catch (error) {
        writeStreamEvent(res, { type: 'error', error: error instanceof Error ? error.message : String(error) })
      } finally {
        res.end()
      }
      return
    }
    if (req.method === 'POST' && url.pathname === '/api/ai/summary') {
      const body = await readJsonRequest(req)
      const result = await codexResponses({
        messages: [{ role: 'user', content: summaryPrompt(body) }],
        maxTokens: 500,
      })
      sendJson(req, res, 200, result)
      return
    }
    sendJson(req, res, 404, { error: 'Not found' })
  } catch (error) {
    sendJson(req, res, 500, { error: error instanceof Error ? error.message : String(error) })
  }
}

function resolvePort() {
  const raw = process.env.HEALTH_DASHBOARD_AI_PORT
  const parsed = raw ? Number(raw) : DEFAULT_PORT
  return Number.isInteger(parsed) && parsed > 0 && parsed < 65536 ? parsed : DEFAULT_PORT
}

async function status() {
  const payload = await statusPayload()
  console.log(JSON.stringify(payload, null, 2))
}

async function server() {
  const port = resolvePort()
  const srv = createServer((req, res) => {
    void handleRequest(req, res)
  })
  srv.listen(port, '127.0.0.1', () => {
    console.log(`Local AI server listening on http://127.0.0.1:${port}`)
    console.log('Run npm run ai:login in another terminal if status is not authenticated.')
  })
}

const command = process.argv[2] || 'help'
try {
  if (command === 'login') await login()
  else if (command === 'server') await server()
  else if (command === 'status') await status()
  else usage()
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
}
