# context-recap

A Claude Code mod that summarises the context of the current session in a side pane, on demand. The recap runs as a side question over the session's own transcript (like `/btw`): it never interrupts the agent, never adds to its context, and reuses the prompt cache, so it costs about as much as a short turn.

Each recap covers:

- **Role**: who the agent is in this session and what it works on.
- **State**: where the work stands now.
- **Done in this session**: the main steps.
- **Rules learnt in this session**: the instructions and corrections the agent now follows.
- **Waiting on me**: the decisions or answers the agent needs from you.

## Install

At the prompt of a Claude Code terminal session:

```text
/plugin install context-recap --marketplace plaffitt/claude-context-recap
```

Answer `y` to add the marketplace, then pick a scope (user scope loads it in every session).

From a shell:

```sh
claude plugin install context-recap --marketplace plaffitt/claude-context-recap
```

In the desktop app, where `/plugin` does not run: click + next to the prompt box, then Plugins, Add marketplace with `plaffitt/claude-context-recap`, then Add plugin.

## Use

- **Show or hide the pane**: the `+ recap` / `− recap` button at the bottom right, above the prompt, or `/context-recap`. The pane's own close mark (or `ctrl+x x` while it has the focus) closes it too.
- **Refresh**: opening the pane runs a new recap when a turn of the conversation ended since the last one. The previous recap stays on screen, marked as updating, until the new one replaces it.
- **Force a recap**: the `Recap` button in the pane (`r` while the pane has the focus).
- **Cost**: each recap shows its tokens: `new` (uncached input, billed in full), `written to cache`, `read from cache` (billed at about a tenth) and `out`. A `read from cache` near zero means the prompt cache had expired and the whole transcript was billed.
- **Resumed session**: until its first turn ends, a resumed session has no request of its own to fork, so the recap reads the transcript the session saved instead (its newest 400 000 characters, tool calls shortened). That first recap is billed in full; once a turn has ended, recaps fork the session again.

A pane closed by hand stays closed in the next sessions until you show it again.

### Keyboard shortcut

Plugins cannot define their own keybinding actions, so the toggle button borrows `diff:back`, an action Claude Code only handles inside the diff dialog. To toggle the pane with `ctrl+x r`, add this binding to the `Global` context of `~/.claude/keybindings.json`:

```json
{
  "context": "Global",
  "bindings": {
    "ctrl+x r": "diff:back"
  }
}
```

Merge it with your existing `Global` bindings, then restart the session. The shortcut works while the band above the prompt is expanded: collapsing it (its `[-]` or `ctrl+x ctrl+a`) hides the button and its shortcut until you expand it again.

## Limits

- The recap covers the session it runs in, not its subagents.
- A new session before its first turn, or one right after `/clear`, has nothing to summarise: the pane says so.
- The band above the prompt yields to Claude Code's own questions and comes back after them.

## Develop

```sh
claude --plugin-dir /path/to/claude-context-recap   # load it in one session
claude plugin validate /path/to/claude-context-recap
claude plugin test /path/to/claude-context-recap
```

## License

[MIT](./LICENSE)
