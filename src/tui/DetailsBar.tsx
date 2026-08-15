import React from 'react'
import { Box, Text } from 'ink'
import type { JobView, SessionMeta } from '../types.ts'
import { shortPath, theme, truncate, type Mode } from '../theme.ts'
import { Badge, Divider, SectionLabel } from './ui.tsx'

export type DetailsTab = 'tasks' | 'settings' | 'trace'

function jobColor(status: JobView['status']): string {
  if (status === 'completed') return theme.success
  if (status === 'failed') return theme.error
  if (status === 'killed' || status === 'stopping') return theme.warn
  return theme.brandBright
}

function jobGlyph(status: JobView['status']): string {
  if (status === 'running') return '●'
  if (status === 'completed') return '✓'
  if (status === 'failed') return '✖'
  return '○'
}

/** The web-style details column: Tasks · Settings · Trace. */
export function DetailsBar({
  width,
  tab,
  onTab,
  jobs,
  model,
  mode,
  autoApprove,
  cwd,
  sessionCount,
  timeline,
}: {
  width: number
  tab: DetailsTab
  onTab: (t: DetailsTab) => void
  jobs: JobView[]
  model: string
  mode: Mode
  autoApprove: boolean
  cwd: string
  sessionCount: number
  timeline: Array<{ time: string; text: string; kind: string }>
}) {
  const innerWidth = Math.max(10, width - 4)
  const TABS: Array<{ id: DetailsTab; label: string }> = [
    { id: 'tasks', label: 'Jobs' },
    { id: 'settings', label: 'Config' },
    { id: 'trace', label: 'Trace' },
  ]

  return (
    <Box
      width={width}
      height="100%"
      flexDirection="column"
      borderLeft
      borderLeftColor={theme.border1}
      paddingX={1}
      flexShrink={0}
    >
      <Box flexDirection="row" gap={0}>
        {TABS.map((t) => {
          const active = t.id === tab
          return (
            <Text key={t.id} color={active ? theme.brandBright : theme.labelCaption} bold={active}>
              {active ? `▎${t.label}` : ` ${t.label}`}
            </Text>
          )
        })}
      </Box>
      <Divider width={innerWidth} />

      {tab === 'tasks' && (
        <Box flexDirection="column">
          <SectionLabel>Background jobs</SectionLabel>
          {jobs.length === 0 && <Text color={theme.labelCaption}>no jobs running</Text>}
          {jobs.map((j) => (
            <Box key={j.id} flexDirection="row">
              <Text color={jobColor(j.status)}>
                {jobGlyph(j.status)}{' '}
              </Text>
              <Text color={theme.labelSecondary}>{truncate(j.label, innerWidth - 4)}</Text>
            </Box>
          ))}
        </Box>
      )}

      {tab === 'settings' && (
        <Box flexDirection="column">
          <SectionLabel>Session</SectionLabel>
          <Text color={theme.labelSecondary}>
            model <Text color={theme.brandBright}>{truncate(model, innerWidth - 8)}</Text>
          </Text>
          <Text color={theme.labelSecondary}>
            mode <Text color={theme.brandBright}>{mode.toUpperCase()}</Text>
          </Text>
          <Text color={theme.labelSecondary}>
            auto-approve <Text color={autoApprove ? theme.success : theme.labelCaption}>{autoApprove ? 'on' : 'off'}</Text>
          </Text>
          <Text color={theme.labelCaption}>sessions {sessionCount}</Text>
          <Text color={theme.labelCaption}>workspace {truncate(shortPath(cwd), innerWidth - 4)}</Text>
          <Divider width={innerWidth} />
          <SectionLabel>Shortcuts</SectionLabel>
          <Text color={theme.labelCaption}>Tab · panels · [ ] width · Shift+Tab mode</Text>
        </Box>
      )}

      {tab === 'trace' && (
        <Box flexDirection="column">
          <SectionLabel>Activity</SectionLabel>
          {timeline.length === 0 && <Text color={theme.labelCaption}>no activity yet</Text>}
          {timeline.map((t, i) => (
            <Box key={i} flexDirection="row">
              <Text color={theme.labelCaption}>{t.time} </Text>
              <Text color={t.kind === 'tool' ? theme.labelCaption : theme.labelSecondary}>{truncate(t.text, innerWidth - 10)}</Text>
            </Box>
          ))}
        </Box>
      )}

      <Box flexGrow={1} />
      <Text color={theme.labelCaption} dimColor>
        ←→ switch tab · Esc close
      </Text>
    </Box>
  )
}
