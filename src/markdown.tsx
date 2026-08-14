import React, { memo, useMemo } from 'react'
import { Box, Text } from 'ink'
import type { Block, Inline } from './markdown.ts'
import { parseMarkdown } from './markdown.ts'
import { theme } from './theme.ts'

function InlineView({ nodes }: { nodes: Inline[] }) {
  return (
    <>
      {nodes.map((n, i) => {
        switch (n.type) {
          case 'text':
            return <Text key={i}>{n.text}</Text>
          case 'bold':
            return (
              <Text key={i} bold color={theme.text}>
                <InlineView nodes={n.children} />
              </Text>
            )
          case 'italic':
            return (
              <Text key={i} italic color={theme.text}>
                <InlineView nodes={n.children} />
              </Text>
            )
          case 'strike':
            return (
              <Text key={i} strikethrough color={theme.textDim}>
                <InlineView nodes={n.children} />
              </Text>
            )
          case 'code':
            return (
              <Text key={i} backgroundColor={theme.codeBg} color={theme.cyan}>
                {n.text}
              </Text>
            )
          case 'link':
            return (
              <Text key={i} color={theme.accent} underline>
                {n.text}
              </Text>
            )
        }
      })}
    </>
  )
}

function CodeBlock({ lang, text }: { lang: string; text: string }) {
  const lines = useMemo(() => text.split('\n'), [text])
  return (
    <Box flexDirection="column" marginY={0}>
      <Box>
        <Text backgroundColor={theme.codeBg} color={theme.textDim}>
          {` ${lang || 'code'} `}
        </Text>
      </Box>
      <Box borderStyle="round" borderColor={theme.border} flexDirection="column" paddingX={1}>
        {lines.map((line, i) => (
          <Text key={i} color={theme.text} backgroundColor={theme.codeBg}>
            {line || ' '}
          </Text>
        ))}
      </Box>
    </Box>
  )
}

const BlockView = memo(function BlockView({ block, depth = 0 }: { block: Block; depth?: number }) {
  switch (block.type) {
    case 'paragraph':
      return (
        <Text wrap="wrap" color={theme.text}>
          <InlineView nodes={block.children} />
        </Text>
      )
    case 'heading': {
      const color = block.level === 1 ? theme.accent : block.level === 2 ? theme.cyan : theme.text
      return (
        <Box flexDirection="column" marginTop={block.level === 1 ? 1 : 0}>
          <Text bold color={color}>
            {'#'.repeat(block.level)} <InlineView nodes={block.children} />
          </Text>
          {block.level === 1 && <Text color={theme.border}>───</Text>}
        </Box>
      )
    }
    case 'code':
      return <CodeBlock lang={block.lang} text={block.text} />
    case 'quote':
      return (
        <Box flexDirection="column" borderLeft={true} borderColor={theme.subtle} paddingLeft={1} marginLeft={0}>
          {block.children.map((b, i) => (
            <BlockView key={i} block={b} depth={depth + 1} />
          ))}
        </Box>
      )
    case 'list':
      return (
        <Box flexDirection="column">
          {block.items.map((item, i) => (
            <Box key={i} flexDirection="column">
              <Box>
                <Text color={theme.cyan}>{block.ordered ? item.marker : '•'}</Text>
                <Box paddingLeft={1} flexDirection="column">
                  {item.children.map((b, j) => (
                    <BlockView key={j} block={b} depth={depth + 1} />
                  ))}
                </Box>
              </Box>
            </Box>
          ))}
        </Box>
      )
    case 'rule':
      return (
        <Text color={theme.border} dimColor>
          ────────────────────────────────
        </Text>
      )
    default:
      return null
  }
})

export const Markdown = memo(function Markdown({ text }: { text: string }) {
  const blocks = useMemo(() => parseMarkdown(text), [text])
  return (
    <Box flexDirection="column">
      {blocks.map((b, i) => (
        <BlockView key={i} block={b} />
      ))}
    </Box>
  )
})
