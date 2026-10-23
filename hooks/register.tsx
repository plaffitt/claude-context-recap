import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Recap, Usage } from '../types'

const PANE = 'context-recap'
const TITLE = 'Context'
// Change the tag when Recap's fields change: it declines what an earlier
// version stored, which outlives a reload.
const recap = atom({ plugin: 'context-recap', key: 'recap' } as const, {} as Recap, { shape: 'recap-2' })
// Whether the pane is on screen, kept by this module: $.ui.panes() did not
// report it shown right after an open.
const shown = atom({ plugin: 'context-recap', key: 'shown' } as const, false)
// Turns of the main conversation completed so far: a recap older than the
// latest one is refreshed when the pane opens.
const turns = atom({ plugin: 'context-recap', key: 'turns' } as const, 0)

// Plugins cannot define keybinding actions: the band's toggle borrows one the
// engine only handles inside the diff dialog, bound in ~/.claude/keybindings.json.
const TOGGLE_ACTION = 'diff:back'
const TOGGLE_KEYS = 'ctrl+x r'

const PROMPT = `Side question, not part of the task: summarise your whole context for me in a few short paragraphs, in the language you use with me. Do not use any tool and do not change what you are doing.

Use these bold headings, and skip a heading that has nothing under it:
- **Role**: who you are in this session and what you work on, in 1 or 2 sentences.
- **State**: where the work stands now (branch, PR, release, what is running).
- **Done in this session**: the main steps, one line each.
- **Rules learnt in this session**: instructions or corrections I gave that you now follow.
- **Waiting on me**: the decisions or answers you need from me, one line each.

Plain text and short lists only, no preamble and no closing line.`

const clock = (ms: number) => {
  const d = new Date(ms)
  const pad = (n: number) => String(n).padStart(2, '0')

  return `${pad(d.getHours())}:${pad(d.getMinutes())}`
}

const why = (r: { reason: string; status?: number | null; error?: string }) => {
  if (r.reason === 'nothing-to-fork') return 'nothing to summarise yet: wait for the end of a first turn'
  if (r.reason === 'api-error') return `API error ${r.error ?? ''} ${r.status ?? ''}`.trim()
  if (r.reason === 'empty-reply') return 'the model answered without text'

  return 'cancelled'
}

// Runs a recap; the last one stays on screen until the new one replaces it.
const run = async ($: EngineInterface) => {
  if ((await read($, recap)).running) return

  const turn = await read($, turns)
  const startedAt = await $.clock.now()
  await update($, recap, (current): Recap => ({ last: current.last, running: { startedAt } }))
  const r = await $.model.fork({ prompt: PROMPT })
  const at = await $.clock.now()
  await update($, recap, (current): Recap =>
    r.isAnswered
      ? { last: { text: r.text.trim(), at, usage: r.usage, turn } }
      : { last: current.last, error: { reason: why(r), at, usage: 'usage' in r ? r.usage : undefined } },
  )
}

// Refreshes the recap when a turn ended since the shown one was made.
const refresh = async ($: EngineInterface) => {
  const { last } = await read($, recap)
  if (!last || last.turn < (await read($, turns))) await run($)
}

const count = (n: number) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ' ')

// Uncached input is billed in full and cache writes a bit above it; cache reads
// cost a tenth, so the first 2 figures are what the recap really costs.
const cost = (u: Usage) =>
  `${count(u.input_tokens)} new, ${count(u.cache_creation_input_tokens)} written to cache, ` +
  `${count(u.cache_read_input_tokens)} read from cache, ${count(u.output_tokens)} out`

// The person's last choice, kept across sessions: a pane closed by hand stays
// closed until it is toggled open again.
const HIDDEN = 'hidden'

const open = async ($: EngineInterface) => {
  const opened = await $.ui.open({ id: PANE, title: TITLE })
  await update($, shown, () => opened.isPlaced)
}

const toggle = async ($: EngineInterface) => {
  if (await read($, shown)) {
    await $.store.set(HIDDEN, true)
    await $.ui.close({ id: PANE })
    // A plugin's own close does not reach its ui.close hook.
    await update($, shown, () => false)

    return 'hidden'
  }
  await $.store.set(HIDDEN, false)
  await open($)
  void refresh($)

  return 'shown'
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'context-recap',
      description: 'Show or hide the Context pane, which summarises this session on demand',
    })
    if ((await $.store.get(HIDDEN)) !== true) void open($)

    return next(e)
  })

  on('command.run', { command: 'context-recap' }, async $ => ({ text: `Context pane ${await toggle($)}.` }))

  on('turn.complete', async ($, e, next) => {
    if (e.agentId === undefined) await update($, turns, n => n + 1)

    return next(e)
  }).catch(($, e, next) => next(e))

  // Any close turns the band's button back to "+"; the pane's own close mark
  // or ctrl+x x also keeps it closed in the next sessions.
  on('ui.close', { id: PANE }, async ($, e, next) => {
    await update($, shown, () => false)
    if (e.origin.kind === 'person') await $.store.set(HIDDEN, true)

    return next(e)
  }).catch(($, e, next) => next(e))

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) return next(e)
    const { Box, Text, Button } = $.ui.resolve(e)
    const isShown = await read($, shown)

    return (
      <Box flexDirection="row" justifyContent="flex-end" width={e.props.bodyColumns}>
        <Button key="toggle" plain action={TOGGLE_ACTION} onPress={() => void toggle($)}>
          {isShown ? '− recap' : '+ recap'} <Text dimColor>{TOGGLE_KEYS}</Text>
        </Button>
      </Box>
    )
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Button, Markdown } = $.ui.resolve(e)
    const { last, running, error } = await read($, recap)

    return (
      <Box flexDirection="column" gap={1}>
        <Box flexDirection="row" gap={1}>
          <Button key="recap" variant="primary" hotkey="r" onPress={() => void run($)}>
            {running ? 'Recap running…' : 'Recap'}
          </Button>
          {running && <Text color="yellow">updating{last ? `, below is the recap of ${clock(last.at)}` : ''}</Text>}
          {!running && last && <Text dimColor>at {clock(last.at)}</Text>}
          {!running && !last && !error && <Text dimColor>a summary of this session's context</Text>}
        </Box>
        {error && !running && (
          <Text color="red">
            No recap at {clock(error.at)}: {error.reason}
          </Text>
        )}
        {last && <Markdown text={last.text} />}
        {last?.usage && <Text dimColor>{cost(last.usage)}</Text>}
      </Box>
    )
  })
}
