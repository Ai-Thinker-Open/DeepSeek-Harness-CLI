import type { ToolDef } from './types.ts'

export const askUser: ToolDef = {
  name: 'ask_user',
  description:
    'Ask the user a question when you need confirmation, a choice, or missing information before proceeding. Present clear options; the user picks one. Use sparingly — only when you genuinely cannot proceed without input.',
  parameters: {
    type: 'object',
    properties: {
      question: { type: 'string', description: 'The question to ask.' },
      options: {
        type: 'array',
        items: { type: 'string' },
        description: 'Optional answer choices. Defaults to a yes/no pair.',
      },
    },
    required: ['question'],
  },
  permission: 'auto',
  planSafe: true,
  summary: (a) => `ask: ${(a.question as string).slice(0, 60)}`,
  async execute(args, ctx) {
    const question = String(args.question ?? '')
    const options = Array.isArray(args.options)
      ? (args.options as string[]).filter((o) => typeof o === 'string' && o.trim())
      : []
    const answer = await ctx.askUser({
      kind: 'ask-user',
      title: question,
      options: options.length ? options : ['Yes', 'No'],
    })
    return `User answered: ${answer}`
  },
}
