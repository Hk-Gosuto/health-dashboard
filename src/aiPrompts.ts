import type { Locale } from './i18n'

export function buildChartSummaryPrompt(params: {
  locale: Locale
  title: string
  description?: string
  dataLength: number
  sampledData: unknown[]
}) {
  const sampledLabel = params.dataLength > 60
    ? (params.locale === 'zh' ? '，已抽样' : ', sampled')
    : ''

  if (params.locale === 'zh') {
    return `你是一位友好、务实的健康教练，正在直接和用户讨论 TA 的个人健康数据。请使用中文回答，用“你/你的”来称呼用户。语气温和但具体，要引用数据中的数字，给出可执行建议。请控制在 3-5 句话内。指出表现不错的地方、值得关注的信号，并给出一个具体行动建议。

图表：“${params.title}”${params.description ? `\n说明：${params.description}` : ''}
用户数据（${params.dataLength} 个点${sampledLabel}）：
${JSON.stringify(params.sampledData, null, 0)}`
  }

  return `You're a friendly health coach talking directly to the user about their personal health data. Speak in second person ("your", "you've", "you're"). Be warm, specific with numbers, and actionable. Keep it to 3-5 sentences. Highlight what's going well, flag anything worth watching, and suggest one concrete thing they could do.

Chart: "${params.title}"${params.description ? `\nDescription: ${params.description}` : ''}
Their data (${params.dataLength} points${sampledLabel}):
${JSON.stringify(params.sampledData, null, 0)}`
}

export function buildInsightsSystemPrompt(locale: Locale, dataContext: string) {
  if (locale === 'zh') {
    return `你是一位健康数据分析师。你可以看到这位用户的 Apple 健康数据摘要：

${dataContext}

规则：
- 用中文回答，除非用户明确要求其他语言
- 直接称呼用户为“你”
- 必须尽量引用数据中的具体数字
- 回答保持简洁，最多 3-5 个短段落
- 不使用 Markdown 格式（不要 **、不要 ##、不要项目符号、不要用横线列清单）
- 只使用自然段落纯文本
- 直接、具体、可执行
- 如果数据不足以支持某个结论，请明确说明

回答结束后，另起一行写入固定标记“FOLLOW_UPS:”，后面给出正好 3 个用户可能继续追问的问题，用“|”分隔。问题也必须使用中文，并且要和刚才的回答具体相关。示例：
FOLLOW_UPS:我该如何改善深睡？|是什么导致我的 HRV 下降？|我应该调整训练安排吗？`
  }

  return `You are a health data analyst. You have access to this person's Apple Health data summary:

${dataContext}

Rules:
- Respond in English unless the user explicitly asks for another language
- Be specific with numbers from the data
- Keep responses concise (3-5 short paragraphs max)
- No markdown formatting (no **, no ##, no bullet points, no dashes for lists)
- Use plain text only with natural paragraph breaks
- Be direct and actionable
- If the data doesn't support an answer, say so

After your response, on a new line write "FOLLOW_UPS:" followed by exactly 3 short follow-up questions the user might want to ask next, separated by "|". Make them specific to what you just discussed. Example:
FOLLOW_UPS:How can I improve my deep sleep?|What's causing my HRV to drop?|Should I change my workout schedule?`
}

const zhQuestions: Record<string, string> = {
  'Give me a comprehensive summary of my overall health based on all the data. What am I doing well? What needs improvement?': '请基于所有数据，全面总结我的整体健康状态。我做得好的地方是什么？哪些方面需要改善？',
  'Analyze my sleep patterns in depth. How is my sleep quality, consistency, and stage breakdown? What is impacting my sleep and what can I do to improve it?': '请深入分析我的睡眠模式。我的睡眠质量、规律性和睡眠阶段分布怎么样？哪些因素可能影响睡眠，我可以怎么改善？',
  'Analyze the relationship between my sleep duration/quality and my next-day HRV, resting heart rate, and exercise performance. Show me the specific numbers.': '请分析我的睡眠时长/质量与次日 HRV、静息心率和运动表现之间的关系，并给出具体数字。',
  'Assess my cardiovascular fitness based on VO2 Max, resting HR, HRV, and walking HR. How do I compare for my age? What should I focus on to improve?': '请基于 VO2 Max、静息心率、HRV 和步行心率评估我的心肺适能。按我的年龄来看表现如何？我应该重点改善什么？',
  'Look at my workout patterns, types, frequency, and intensity. Am I training effectively? What changes would give me the most improvement?': '请查看我的训练模式、类型、频率和强度。我现在训练是否有效？哪些调整最可能带来提升？',
  'Based on my data trends, what are my biggest health risk factors? Are there any concerning patterns I should discuss with a doctor?': '基于我的数据趋势，我最大的健康风险因素是什么？有没有值得和医生讨论的异常模式？',
  'Compare my last 7 days vs the previous 7 days across all metrics. What improved? What got worse? Am I trending in the right direction?': '请比较我最近 7 天和前 7 天的所有指标。哪些改善了？哪些变差了？整体趋势是否正确？',
  'Am I balancing exercise and recovery well? Look at my workout frequency, HRV trends, resting HR recovery, and sleep on training vs rest days.': '我的运动和恢复平衡得好吗？请结合训练频率、HRV 趋势、静息心率恢复，以及训练日和休息日的睡眠来分析。',
}

export function localizeQuestion(question: string, locale: Locale) {
  return locale === 'zh' ? (zhQuestions[question] ?? question) : question
}
