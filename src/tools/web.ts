import type { ToolDef } from './types.ts'
import { fetchPage, searchWeb } from './search.ts'

export const webSearch: ToolDef = {
  name: 'web_search',
  description:
    'Search the web for current information. Returns an optional answer plus a list of source URLs with snippets. Follow up with web_fetch when you need the full content of a specific result, and cite the relevant URLs as markdown links.',
  parameters: {
    type: 'object',
    properties: { query: { type: 'string', description: 'The search query.' } },
    required: ['query'],
  },
  permission: 'auto',
  planSafe: true,
  summary: (a) => `search: ${a.query}`,
  async execute(args) {
    const query = String(args.query ?? '')
    try {
      const results = await searchWeb(query, 8)
      if (!results.length) return `No results for "${query}"`
      return results
        .map((r, i) => `${i + 1}. ${r.title}\n   ${r.url}\n   ${r.snippet}`)
        .join('\n')
    } catch (e) {
      return `web_search failed: ${(e as Error).message}`
    }
  },
}

export const webFetch: ToolDef = {
  name: 'web_fetch',
  description:
    'Retrieve the content of a specific HTTP(S) URL (for example a result from web_search). Returns the page content decoded to text. Cite the URL as a markdown link when you use its content.',
  parameters: {
    type: 'object',
    properties: { url: { type: 'string', description: 'The URL to fetch.' } },
    required: ['url'],
  },
  permission: 'auto',
  planSafe: true,
  summary: (a) => `fetch ${a.url}`,
  async execute(args) {
    const url = String(args.url ?? '')
    try {
      return await fetchPage(url)
    } catch (e) {
      return `web_fetch failed: ${(e as Error).message}`
    }
  },
}
