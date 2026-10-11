// An invisible layer over an agent row's name, preview and count in the inbox list: a press there picks the agent.
// The desktop does not pass presses on the row's photo to a plugin layer, so the photo itself does not pick.
import type { ClientModule } from 'claude-code'

const RowPick: ClientModule<null, true> = (_props, surface) => {
  const { Box } = surface.elements
  if (surface.state === undefined) {
    surface.setState(true)
    // A press or its release picks (a surface that reports only one of them still works); picking twice is harmless.
    surface.onPointer(event => {
      if ((event.type === 'down' || event.type === 'up') && event.button !== 'right') surface.post({ pick: true })
    })
    surface.onKey(key => {
      if (key.key === 'return' || key.key === 'space' || key.key === ' ') surface.post({ pick: true })
    })
  }

  return <Box width="100%" height="100%" />
}

export default RowPick
