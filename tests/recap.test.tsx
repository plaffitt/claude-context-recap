import { expect, mock, test } from 'claude-code/testing'

// The test environment has timers; the mod's lib leaves them out of its types.
declare const setTimeout: (callback: (value?: unknown) => void, ms: number) => unknown

const PANE = {
  plugin: 'context-recap',
  component: 'Pane',
  requestId: 'context-recap',
  props: {
    title: 'Context',
    isFocused: false,
    bodyColumns: 60,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 30 },
    view: {},
  },
} as const

const usage = { input_tokens: 310, output_tokens: 480, cache_read_input_tokens: 41900, cache_creation_input_tokens: 100 }

for (const surface of ['terminal', 'desktop'] as const) {
  test(`pressing Recap shows the fork's answer and its cost, on ${surface}`, async ($, on) => {
    mock.clock(on)
    on('model.fork', () => ({ value: { isAnswered: true, text: '**Role**: coordinator', usage } }))

    const ui = await $.ui.mount({ ...PANE, surface })
    expect((await ui.find({ type: 'Text', text: /summary of this session/ }))?.text).toBeDefined()

    await ui.press({ key: 'recap' })

    expect((await ui.find({ type: 'Markdown' }))?.text).toContain('coordinator')
    expect((await ui.find({ type: 'Text', text: /read from cache/ }))?.text).toBe(
      '310 new, 100 written to cache, 41 900 read from cache, 480 out',
    )
    await ui.unmount()
  })

  test(`a resumed session with nothing to fork recaps its saved transcript, on ${surface}`, async ($, on) => {
    mock.clock(on)
    let sent = ''
    on('model.fork', () => ({ value: { isAnswered: false, reason: 'nothing-to-fork' } }))
    on('session.messages', () => ({
      value: [
        { role: 'user', text: 'Rename the Taskfile tasks', toolUses: [] },
        { role: 'assistant', text: 'An agent renames them.', toolUses: [] },
      ],
    }))
    on('session.model', () => ({ value: 'opus' }))
    on('model.complete', (_, e) => {
      sent = e.prompt

      return { value: { isAnswered: true, text: '**Role**: renamer', usage } }
    })

    const ui = await $.ui.mount({ ...PANE, surface })
    await ui.press({ key: 'recap' })

    expect(sent).toContain('User: Rename the Taskfile tasks')
    expect((await ui.find({ type: 'Markdown' }))?.text).toContain('renamer')
    await ui.unmount()
  })

  test(`a session with nothing to fork says so, on ${surface}`, async ($, on) => {
    mock.clock(on)
    on('model.fork', () => ({ value: { isAnswered: false, reason: 'nothing-to-fork' } }))
    on('session.messages', () => ({ value: [] }))

    const ui = await $.ui.mount({ ...PANE, surface })
    await ui.press({ key: 'recap' })

    expect((await ui.find({ type: 'Text', text: /No recap/ }))?.text).toContain('nothing to summarise yet')
    await ui.unmount()
  })

  test(`a running recap keeps the last one on screen, then replaces it, on ${surface}`, async ($, on) => {
    mock.clock(on)
    let answer = '**Role**: first'
    let release = () => {}
    let isHeld = false
    on('model.fork', async () => {
      if (isHeld) await new Promise<void>(resolve => (release = resolve))

      return { value: { isAnswered: true, text: answer, usage } }
    })

    const ui = await $.ui.mount({ ...PANE, surface })
    await ui.press({ key: 'recap' })

    answer = '**Role**: second'
    isHeld = true
    const pressing = ui.press({ key: 'recap' })
    await new Promise(resolve => setTimeout(resolve, 0))
    expect((await ui.find({ type: 'Text', text: /updating/ }))?.text).toMatch(
      /^updating, below is the recap of \d\d:\d\d$/,
    )
    expect((await ui.find({ type: 'Markdown' }))?.text).toContain('first')

    release()
    await pressing
    expect((await ui.find({ type: 'Markdown' }))?.text).toContain('second')
    expect(await ui.find({ type: 'Text', text: /updating/ })).toBeUndefined()
    await ui.unmount()
  })

  test(`the band's button opens then closes the pane, on ${surface}`, async ($, on) => {
    mock.store(on, { hidden: true })
    mock.clock(on)
    const calls: string[] = []
    on('model.fork', () => {
      calls.push('fork')

      return { value: { isAnswered: true, text: '**Role**: coordinator', usage } }
    })
    on('turn.complete', () => ({ text: '' }))
    on('ui.open', (_, e) => {
      calls.push(`open ${e.id}`)

      return { value: { isPlaced: true } }
    })
    on('ui.close', (_, e) => {
      calls.push(`close ${e.id}`)

      return { value: undefined }
    })

    const band = await $.ui.mount({
      plugin: 'context-recap',
      surface,
      component: 'AbovePrompt',
      props: {
        hasSurvey: false,
        isWorking: false,
        maxRows: 10,
        bodyColumns: 80,
        scroll: { offset: 0, bodyRows: 10 },
        view: {},
      },
    })
    expect((await band.find({ type: 'Button', key: 'toggle' }))?.text).toBe('+ recap alt+r')

    await band.press({ key: 'toggle' })
    expect((await band.find({ type: 'Button', key: 'toggle' }))?.text).toBe('− recap alt+r')

    await band.press({ key: 'toggle' })
    // Opened with no recap yet, the pane makes one; nothing new since, the
    // next opening does not.
    expect(calls).toEqual(['open context-recap', 'fork', 'close context-recap'])
    expect((await band.find({ type: 'Button', key: 'toggle' }))?.text).toBe('+ recap alt+r')
    await band.press({ key: 'toggle' })
    expect(calls).toEqual(['open context-recap', 'fork', 'close context-recap', 'open context-recap'])

    // A subagent's turn is not the conversation's; a main turn makes the
    // next opening refresh the recap.
    const turn = { answer: '', durationMs: 1, isAborted: false, reason: 'answer' } as const
    await $.turn.complete({ ...turn, turnId: 't1', agentId: 'a1' })
    await band.press({ key: 'toggle' })
    await band.press({ key: 'toggle' })
    expect(calls.filter(call => call === 'fork')).toHaveLength(1)

    await $.turn.complete({ ...turn, turnId: 't2' })
    await band.press({ key: 'toggle' })
    await band.press({ key: 'toggle' })
    expect(calls.filter(call => call === 'fork')).toHaveLength(2)
    await band.unmount()
  })

  test(`the shortcut option labels the band's button, on ${surface}`, { options: { shortcut: '' } }, async $ => {
    const band = await $.ui.mount({
      plugin: 'context-recap',
      surface,
      component: 'AbovePrompt',
      props: {
        hasSurvey: false,
        isWorking: false,
        maxRows: 10,
        bodyColumns: 80,
        scroll: { offset: 0, bodyRows: 10 },
        view: {},
      },
    })
    expect((await band.find({ type: 'Button', key: 'toggle' }))?.text).toBe('+ recap')
    await band.unmount()
  })

  test(`a new session opens the pane, on ${surface}`, async ($, on) => {
    mock.store(on)
    const opened: string[] = []
    on('command.register', () => ({ value: { command: 'context-recap' } }))
    on('ui.open', (_, e) => {
      opened.push(e.id)

      return { value: { isPlaced: true } }
    })
    on('session.start', (_, e) => ({ cwd: e.cwd }))

    await $.session.start({ cwd: '/', surface, isInteractive: true })
    expect(opened).toEqual(['context-recap'])
  })

  test(`a pane closed by hand stays closed in the next session, on ${surface}`, async ($, on) => {
    mock.store(on, { hidden: true })
    const opened: string[] = []
    on('command.register', () => ({ value: { command: 'context-recap' } }))
    on('ui.open', (_, e) => {
      opened.push(e.id)

      return { value: { isPlaced: true } }
    })
    on('session.start', (_, e) => ({ cwd: e.cwd }))

    await $.session.start({ cwd: '/', surface, isInteractive: true })
    expect(opened).toEqual([])
  })
}
