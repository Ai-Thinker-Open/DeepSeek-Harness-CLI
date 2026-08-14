/** Web search and fetch without an API key (DuckDuckGo HTML endpoint). */

export interface SearchResult {
  title: string
  url: string
  snippet: string
}

const UA =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36'

export async function searchWeb(query: string, maxResults = 8): Promise<SearchResult[]> {
  // Cascade: DuckDuckGo HTML → lite → instant-answer API (each can be bot-gated).
  try {
    const r = await searchDdgHtml(query, maxResults)
    if (r.length) return r
  } catch {
    /* fall through */
  }
  try {
    const r = await searchDdgLite(query, maxResults)
    if (r.length) return r
  } catch {
    /* fall through */
  }
  return searchDdgInstantAnswer(query)
}

async function searchDdgHtml(query: string, max: number): Promise<SearchResult[]> {
  const body = new URLSearchParams({ q: query })
  const res = await fetch('https://html.duckduckgo.com/html/', {
    method: 'POST',
    headers: { 'user-agent': UA, 'content-type': 'application/x-www-form-urlencoded' },
    body,
    signal: AbortSignal.timeout(30_000),
  })
  if (!res.ok) throw new Error(`search failed: HTTP ${res.status}`)
  const html = await res.text()
  return parseResults(html, max)
}

async function searchDdgLite(query: string, max: number): Promise<SearchResult[]> {
  const res = await fetch(`https://lite.duckduckgo.com/lite/?q=${encodeURIComponent(query)}`, {
    headers: { 'user-agent': UA },
    signal: AbortSignal.timeout(30_000),
  })
  if (!res.ok) throw new Error(`lite search failed: HTTP ${res.status}`)
  const html = await res.text()
  const out: SearchResult[] = []
  // organic results (when not bot-gated)
  const blockRe = /<a[^>]*class="result-link"[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/g
  let m: RegExpExecArray | null
  while ((m = blockRe.exec(html)) !== null && out.length < max) {
    out.push({ title: decodeHtml(stripTags(m[2] as string)).trim(), url: decodeHtml(m[1] as string), snippet: '' })
  }
  // zero-click info block
  if (!out.length) {
    const zc = /Zero-click info:\s*<a[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>([\s\S]*?)(?=<tr>|<\/table>)/.exec(html)
    if (zc) {
      out.push({
        title: decodeHtml(stripTags(zc[2] as string)).trim(),
        url: decodeHtml(zc[1] as string),
        snippet: decodeHtml(stripTags(zc[3] as string)).replace(/\s+/g, ' ').trim().slice(0, 300),
      })
    }
  }
  return out
}

async function searchDdgInstantAnswer(query: string): Promise<SearchResult[]> {
  const res = await fetch(`https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1&no_redirect=1`, {
    headers: { 'user-agent': UA },
    signal: AbortSignal.timeout(30_000),
  })
  if (!res.ok) throw new Error(`instant answer failed: HTTP ${res.status}`)
  const j = (await res.json()) as {
    AbstractText?: string
    AbstractURL?: string
    Heading?: string
    RelatedTopics?: Array<{ Text?: string; FirstURL?: string; Topics?: Array<{ Text?: string; FirstURL?: string }> }>
  }
  const out: SearchResult[] = []
  if (j.AbstractURL && j.AbstractText) {
    out.push({ title: j.Heading || j.AbstractURL, url: j.AbstractURL, snippet: j.AbstractText.slice(0, 300) })
  }
  const walk = (topics: Array<{ Text?: string; FirstURL?: string; Topics?: Array<{ Text?: string; FirstURL?: string }> }>): void => {
    for (const t of topics) {
      if (t.FirstURL && t.Text) out.push({ title: t.Text.split(' - ')[0] ?? t.Text, url: t.FirstURL, snippet: t.Text.slice(0, 200) })
      if (t.Topics) walk(t.Topics)
      if (out.length >= 8) return
    }
  }
  walk(j.RelatedTopics ?? [])
  return out
}

function parseResults(html: string, max: number): SearchResult[] {
  const out: SearchResult[] = []
  // Each result block: <a class="result__a" href="...">title</a> ... <a class="result__snippet">snippet</a>
  const blockRe = /<a[^>]*class="result__a"[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>([\s\S]*?)(?=<a[^>]*class="result__a"|$)/g
  let m: RegExpExecArray | null
  while ((m = blockRe.exec(html)) !== null && out.length < max) {
    let url = decodeHtml(m[1] as string)
    // DDG redirect URLs: strip uddg= and ddg= params
    try {
      const u = new URL(url)
      const uddg = u.searchParams.get('uddg')
      const ddg = u.searchParams.get('ddg')
      if (uddg) url = decodeURIComponent(uddg)
      else if (ddg) url = decodeURIComponent(ddg)
    } catch {
      /* keep as-is */
    }
    const title = decodeHtml(stripTags(m[2] as string)).trim()
    const snippetM = /<a[^>]*class="result__snippet"[^>]*>([\s\S]*?)<\/a>/.exec(m[3] as string)
    const snippet = snippetM ? decodeHtml(stripTags(snippetM[1] as string)).trim() : ''
    if (title && /^https?:/.test(url)) out.push({ title, url, snippet })
  }
  return out
}

export async function fetchPage(url: string): Promise<string> {
  const res = await fetch(url, {
    headers: { 'user-agent': UA, accept: 'text/html,text/plain,*/*' },
    redirect: 'follow',
    signal: AbortSignal.timeout(30_000),
  })
  const ct = res.headers.get('content-type') ?? ''
  const text = (await res.text()).slice(0, 2_000_000)
  const head = `URL: ${url}\nStatus: ${res.status} ${res.statusText}\n`
  if (res.status >= 400) return `${head}\n${text.slice(0, 2000)}`
  if (ct.includes('html')) return head + '\n' + htmlToText(text)
  return head + '\n' + text.slice(0, 200_000)
}

export function htmlToText(html: string): string {
  let s = html
  s = s.replace(/<script[\s\S]*?<\/script>/gi, ' ')
  s = s.replace(/<style[\s\S]*?<\/style>/gi, ' ')
  s = s.replace(/<(br|\/p|\/div|\/li|\/h[1-6]|\/tr|\/ul|\/ol|\/blockquote)[^>]*>/gi, '\n')
  s = s.replace(/<[^>]+>/g, ' ')
  s = decodeHtml(s)
  s = s.replace(/[ \t]+/g, ' ').replace(/\n\s*\n+/g, '\n\n')
  return s.trim().slice(0, 200_000)
}

function stripTags(s: string): string {
  return s.replace(/<[^>]+>/g, '')
}

function decodeHtml(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&#x27;/g, "'")
    .replace(/&apos;/g, "'")
}
