# Rail Runner

A Claude Code mod that plays an ASCII endless runner in a side pane while Claude is working.

```
RAIL RUNNER * 12 340m
| |---|  .-----.  |---| |
|    *   | [][] |   *   :
| |---|  |o   o|  |---| :
|        '====='        |
| H===H    |---|        |
|           O           :
|          /|\          :
| |---|    / \    |---| |
```

A stick-figure runner dodges trains on three tracks, jumps barriers (`H===H`) and collects coins (`*`). The track is generated from a fixed formula, so it never ends and always leaves an open lane. An autopilot steers the runner.

## Behavior

- Submitting a prompt opens the **Rail Runner** pane.
- The run animates while Claude is working (about 9 frames a second) and pauses when the turn ends. Coins and distance carry over between turns.
- `/rail-runner` opens the pane by hand.

The pane docks beside the transcript when the terminal is in fullscreen and at least 110 columns wide; otherwise it shows above the prompt.

## Install

```sh
git clone https://github.com/tylergraydev/rail-runner
claude --plugin-dir ./rail-runner
```

Check it with `claude plugin validate ./rail-runner`.

## Layout

- `.claude-plugin/plugin.json`: manifest
- `hooks/hooks.json`: lists the hooks module
- `hooks/register.tsx`: the mod (world generation, autopilot, drawing, hooks)
- `types/index.d.ts`: the mod's `$.state` contract
