import { bash } from './bash.ts'
import { fsDelete, fsEdit, fsGlob, fsGrep, fsLs, fsRead, fsWrite } from './fs.ts'
import { webFetch, webSearch } from './web.ts'
import { askUser } from './askUser.ts'
import { todoList, todoWrite } from './todo.ts'
import { goalTool } from './goal.ts'
import { jobTools } from './jobs.ts'
import { workflowTool } from './workflow.ts'
import { skillListTool, skillLoadTool } from './skill.ts'
import { exitPlanModeTool } from './plan.ts'
import type { ToolDef } from './types.ts'

export * from './types.ts'

/** The default DSH-mirroring tool suite. */
export function defaultTools(): ToolDef[] {
  return [
    bash,
    fsRead,
    fsWrite,
    fsEdit,
    fsLs,
    fsGlob,
    fsGrep,
    fsDelete,
    webSearch,
    webFetch,
    askUser,
    todoWrite,
    todoList,
    goalTool,
    ...jobTools,
    workflowTool,
    skillListTool,
    skillLoadTool,
    exitPlanModeTool,
  ]
}
