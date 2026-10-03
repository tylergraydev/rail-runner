export type Run = {
  tick: number
  lane: number
  coins: number
  jumpUntil: number
  isRunning: boolean
}

declare module 'claude-code' {
  interface PluginState {
    'rail-runner': { run: Run }
  }
}
