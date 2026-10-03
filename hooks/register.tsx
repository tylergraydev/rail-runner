import { atom, read, update } from 'claude-code'
import type { Register, Timer } from 'claude-code'

import type { Run } from '../types'

const PANE = 'rail-runner'
const TITLE = 'Rail Runner'
const TICK_MS = 110
const LANES = 3
const SEG = 9 // world rows per track segment
const LOOKAHEAD = 7

const run = atom({ plugin: 'rail-runner', key: 'run' } as const, {
  tick: 0,
  lane: 1,
  coins: 0,
  jumpUntil: -1,
  isRunning: false,
})

// ---------- the world: a pure function of (row, lane) ----------

const hash = (a: number, b: number): number => {
  let x = (a * 374761393 + b * 668265263) | 0
  x = Math.imul(x ^ (x >>> 13), 1274126177)
  x ^= x >>> 16
  return (x >>> 0) / 4294967296
}

const hasTrainInSegment = (s: number, lane: number): boolean => {
  if (s < 2) return false
  const wants = [0, 1, 2].map(l => hash(s, l) < 0.42)
  if (wants.every(Boolean)) wants[s % LANES] = false // always leave a way through
  return wants[lane]
}

// The train's rows inside its segment: [start, start + 4]; start is its front.
const trainStart = (s: number, lane: number): number => s * SEG + Math.floor(hash(s, lane + 7) * 3)

type Cell = 'empty' | 'train-front' | 'train-lights' | 'train-body' | 'train-back' | 'barrier' | 'coin'

const cellAt = (row: number, lane: number): Cell => {
  const s = Math.floor(row / SEG)
  if (hasTrainInSegment(s, lane)) {
    const off = row - trainStart(s, lane)
    if (off === 0) return 'train-front'
    if (off === 1) return 'train-lights'
    if (off > 1 && off < 4) return 'train-body'
    if (off === 4) return 'train-back'
    return 'empty'
  }
  const off = row - s * SEG
  if (s >= 2 && off === 7 && hash(s, lane + 20) < 0.35) return 'barrier'
  if (hash(s, lane + 60) < 0.5 && off >= 1 && off <= 5 && off % 2 === 1) return 'coin'
  return 'empty'
}

const isTrain = (row: number, lane: number) => cellAt(row, lane).startsWith('train')

// ---------- the runner's autopilot ----------

const firstTrain = (from: number, lane: number): number => {
  for (let k = 0; k <= LOOKAHEAD; k++) if (isTrain(from + k, lane)) return k
  return Infinity
}

const step = (r: Run): Run => {
  const tick = r.tick + 1
  let { lane, coins, jumpUntil } = r

  if (firstTrain(tick, lane) <= LOOKAHEAD) {
    let best = lane
    let bestDist = firstTrain(tick, lane)
    for (let l = 0; l < LANES; l++) {
      const d = firstTrain(tick, l) - Math.abs(l - lane) * 0.1 // prefer near lanes
      if (d > bestDist) {
        best = l
        bestDist = d
      }
    }
    lane = best
  }

  const isAirborne = tick < jumpUntil
  if (!isAirborne && (cellAt(tick + 1, lane) === 'barrier' || isTrain(tick, lane))) {
    jumpUntil = tick + 4
  }
  if (cellAt(tick, lane) === 'coin') coins += 1

  return { ...r, tick, lane, coins, jumpUntil }
}

// ---------- drawing ----------

type Seg = { text: string; color?: string; dim?: boolean; bold?: boolean }

const center = (s: string, w: number): string => {
  const left = Math.floor((w - s.length) / 2)
  return ' '.repeat(Math.max(0, left)) + s + ' '.repeat(Math.max(0, w - s.length - left))
}

const trackCell = (row: number, lane: number, w: number): Seg => {
  const inner = w - 2
  switch (cellAt(row, lane)) {
    case 'train-back':
      return { text: '.' + '-'.repeat(inner) + '.', color: 'cyan' }
    case 'train-body':
      return { text: '|' + center('[]'.repeat(Math.max(1, Math.floor(inner / 3))), inner) + '|', color: 'cyan' }
    case 'train-lights':
      return { text: '|' + center('o   o'.slice(0, Math.max(3, inner)), inner) + '|', color: 'cyan', bold: true }
    case 'train-front':
      return { text: "'" + '='.repeat(inner) + "'", color: 'cyan' }
    case 'barrier':
      return { text: 'H' + '='.repeat(inner) + 'H', color: 'yellow' }
    case 'coin':
      return { text: center('*', w), color: 'yellow', bold: true }
    default: {
      const tie = row % 2 === 0 ? '-' : ' '
      return { text: ' |' + tie.repeat(Math.max(0, w - 4)) + '| ', dim: true }
    }
  }
}

const runnerSprite = (r: Run, row: number): string | null => {
  const isAirborne = r.tick < r.jumpUntil
  const base = r.tick + (isAirborne ? 1 : 0)
  const off = row - base
  if (off === 2) return 'O'
  if (off === 1) return isAirborne ? '\\|/' : r.tick % 2 ? '/|\\' : '-|\\'
  if (off === 0) return isAirborne ? '/ \\' : r.tick % 2 ? '/ \\' : ' |\\'
  if (isAirborne && off === -1) return '~~~'
  return null
}

const drawLine = (r: Run, row: number, w: number): Seg[] => {
  const wall = row % 4 < 2 ? '|' : ':'
  const out: Seg[] = [{ text: wall, dim: true }]
  for (let lane = 0; lane < LANES; lane++) {
    const sprite = lane === r.lane ? runnerSprite(r, row) : null
    if (sprite) {
      out.push({ text: center(sprite, w), color: sprite === '~~~' ? undefined : 'magenta', dim: sprite === '~~~', bold: true })
    } else {
      out.push(trackCell(row, lane, w))
    }
    out.push({ text: lane < LANES - 1 ? ' ' : wall, dim: true })
  }
  return out
}

// ---------- hooks ----------

export const register: Register = on => {
  let timer: Timer | undefined

  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'rail-runner',
      description: 'Open the Rail Runner pane (it plays while Claude works)',
    })
    // One timer for the whole session (work that outlives a dispatch starts
    // here); it only advances the run while a turn is going.
    timer?.cancel()
    timer = $.clock.every(TICK_MS, () => {
      void (async () => {
        if ((await read($, run)).isRunning) await update($, run, step)
      })()
    })
    return next(e)
  })

  on('command.run', { command: 'rail-runner' }, async $ => {
    await $.ui.open({ id: PANE, title: TITLE })
    return { text: 'Rail Runner opened. It runs while Claude is working.' }
  })

  // Opening from the prompt the person submitted counts as their own act,
  // so the pane seats at any width.
  on('prompt.submit', async ($, e, next) => {
    void $.ui.open({ id: PANE, title: TITLE })
    return next(e)
  })

  on('turn.start', async ($, e, next) => {
    await update($, run, r => ({ ...r, isRunning: true }))
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    await update($, run, r => ({ ...r, isRunning: false }))
    return next(e)
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text } = $.ui.resolve(e)
    const r = await read($, run)

    const cols = e.props.bodyColumns || e.viewport?.columns || 40
    const w = Math.max(5, Math.min(11, Math.floor((cols - 4) / LANES)))
    const height = Math.max(10, Math.min(40, (e.viewport?.rows ?? 30) - 8))

    const lines: Seg[][] = []
    for (let i = 0; i < height; i++) lines.push(drawLine(r, r.tick + (height - 3) - i, w))

    return (
      <Box flexDirection="column">
        <Box>
          <Text bold color="magenta">RAIL RUNNER </Text>
          <Text color="yellow">* {r.coins} </Text>
          <Text dimColor>{r.tick}m</Text>
        </Box>
        {lines.map((segs, i) => (
          <Box key={`l${i}`}>
            {segs.map((s, j) => (
              <Text key={`s${j}`} color={s.color} dimColor={s.dim} bold={s.bold} wrap="truncate">
                {s.text}
              </Text>
            ))}
          </Box>
        ))}
        <Text dimColor>{r.isRunning ? 'Claude is working...' : 'Waiting for Claude.'}</Text>
      </Box>
    )
  })
}
