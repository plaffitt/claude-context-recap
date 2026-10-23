export type Usage = {
  input_tokens: number
  output_tokens: number
  cache_read_input_tokens: number
  cache_creation_input_tokens: number
}

// The last recap stays on screen while a newer one runs or after one fails.
export type Recap = {
  last?: { text: string; at: number; usage?: Usage; turn: number }
  running?: { startedAt: number }
  error?: { reason: string; at: number; usage?: Usage }
}

declare module 'claude-code' {
  interface PluginState {
    'context-recap': { recap: Shaped<Recap>; shown: boolean; turns: number }
  }
}
