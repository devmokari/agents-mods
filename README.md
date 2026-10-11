# agent-mode

A Claude Code mod: named subagents with photos, each with its own chat in an Agents inbox beside the main chat.

- `/faces` opens the inbox. Tiled (under 70 columns) it is the agent list alone; filled, the picked agent's chat runs full width above a bottom agent bar (search and + first, then a card per agent; cards wrap onto more lines, since the host has no horizontal scroll). Pick an agent, type, send; Claude starts it and the answer lands in its chat.
- Each row: portrait, name, last message (20 characters, then `...`) and a green unread count. Unread clears only when the chat is on screen in the filled pane.
- **⌕** searches; **+** adds a new agent or opens **Edit agents** (title, team, model, pin, teams). Each agent's **⋯** has Rename and Delete (Delete asks first).
- Colours use theme keys and translucent tints, so light and dark themes both read.

## Host limits (checked live)

- **Photos do not pick.** On desktop a press on a row's name, the rest of its line, or its preview line opens the agent; a press on its photo does nothing. The contract makes `Svg` a leaf ("nothing reaches inside; a press other plugins should see goes on an enclosing Button"), but a `Button` takes only text children, and an absolute layer's pointer "is on its parent". Live, a layer over the photo or the whole row received no press (v0.1.43, v0.1.44). `Client` modules have no image element. Missing host capability: a pressable image (`Svg` inside `Button`, or `onPress` on `Svg`/`Box`). The terminal opens an agent from its name button.
- **Sticky pill, composer and bar (experimental, v0.1.55).** `Box` has no sticky or scrolling region, so the filled pane's screen is drawn exactly one screen tall (`height` = the pane's rows, clipped) and its history is a clipped window between the pill and the composer. A screen that fits raised no wheel event live (v0.1.54: the history never moved), so an empty runway half a screen tall follows it, giving the desktop room to scroll; a move the desktop makes anyway is put back at the top. A `ui.scroll` hook takes the person's wheel over the pane (no `next`, so the pane's own move is denied) and moves that window: a tick 3 rows, a page or fling as far as it asks, stopping at the newest and the oldest; ↓ Newest jumps back. Row heights are estimated from the words, so a long wrapped message may be clipped at the window's top until scrolled. The wheel's pointer cell is not reported on desktop, so a wheel anywhere on the filled pane moves the history. Tiled and Edit agents scroll natively.
- **Shapes are the host's.** `Box` has no corner-radius prop; `borderStyle: 'round'` draws the desktop's own fixed small radius. So the search and + frames and the chat's header pill are rounded rectangles, not the mock's circles and capsule. An image could draw those shapes, but an image takes the presses of whatever sits on it (see photos above), so it cannot sit behind the buttons. Behind the header pill, which takes no presses, a capsule image was tried in v0.1.49 (sized by its slot) and v0.1.50 (explicit pixels): neither drew live. There are no one-sided borders, so the mock's line between list and chat is left out: a one-column tinted strip (v0.1.48) drew as a heavy 16px stripe, and a 1px line image in that slot (v0.1.49, v0.1.50) did not draw.
- **Tile or fill is judged by width** (70 columns): the host does not say whether the pane is maximised.
- Agents can message each other (`message_teammate`) and change their own profile (`update_my_profile`).

## Files

| File | What |
| --- | --- |
| `hooks/register.tsx` | The hooks module: every hook and everything that uses `$` (the engine requires both in one file) |
| `hooks/model.ts` | Roster, chat rows, profiles, tool schemas |
| `hooks/relay.ts` | Handovers, briefings, steps, reports, teammate queue, activity |
| `hooks/faces.ts` | Drawn faces, photos, status ring |
| `hooks/state.ts` | Constants, palette, desktop composer bookkeeping |
| `hooks/composer.tsx`, `hooks/rowpick.tsx` | Desktop message box and row picker (loaded as Client modules) |
| `tests/` | `world.tsx` holds the shared setup; one test file per area |

## Install or update

    claude plugin marketplace add ~/agent-mode
    claude plugin install agent-mode@agents-mods

After a change: bump `version` in `.claude-plugin/plugin.json`, then run `claude plugin marketplace update agents-mods` and `claude plugin update agent-mode@agents-mods`, and restart Claude. `/reload-plugins` alone does not pick up edits.

## Check

    claude plugin validate .
    claude plugin test .
