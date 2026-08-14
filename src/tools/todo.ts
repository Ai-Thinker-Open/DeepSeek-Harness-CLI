import type { TodoItem } from '../types.ts'
import type { ToolDef } from './types.ts'

export const todoWrite: ToolDef = {
  name: 'todo_write',
  description:
    'Record and update the structured task list for the current work. Send the ENTIRE list every call — it REPLACES the previous list. Use it to plan multi-step work and show progress. Statuses: pending | in_progress | completed.',
  parameters: {
    type: 'object',
    properties: {
      todos: {
        type: 'array',
        description: 'The complete task list.',
        items: {
          type: 'object',
          properties: {
            content: { type: 'string', description: 'A short imperative line.' },
            status: { type: 'string', enum: ['pending', 'in_progress', 'completed'] },
          },
          required: ['content', 'status'],
        },
      },
    },
    required: ['todos'],
  },
  permission: 'auto',
  planSafe: true,
  summary: (a) => `todo_write (${((a.todos as unknown[]) ?? []).length} items)`,
  async execute(args, ctx) {
    const raw = Array.isArray(args.todos) ? (args.todos as Array<Record<string, unknown>>) : []
    const todos: TodoItem[] = raw.map((t, i) => ({
      id: String(i + 1),
      content: String(t.content ?? ''),
      status: t.status === 'completed' || t.status === 'in_progress' ? t.status : 'pending',
    }))
    ctx.setTodos(todos)
    ctx.emit({ type: 'todos', todos })
    const pending = todos.filter((t) => t.status !== 'completed').length
    return `Todo list updated (${todos.length} items, ${pending} not completed).\n` + todos
      .map((t) => `[${t.status === 'completed' ? 'x' : t.status === 'in_progress' ? '→' : ' '}] ${t.content}`)
      .join('\n')
  },
}

export const todoList: ToolDef = {
  name: 'todo_list',
  description: 'Read the current todo list for this session.',
  parameters: { type: 'object', properties: {} },
  permission: 'auto',
  planSafe: true,
  summary: () => 'todo_list',
  async execute(_args, ctx) {
    const todos = ctx.getTodos()
    if (!todos.length) return 'No todos yet.'
    return todos.map((t) => `[${t.status === 'completed' ? 'x' : t.status === 'in_progress' ? '→' : ' '}] ${t.content}`).join('\n')
  },
}
