import ChatComposer from './chat-composer'
import ChatTools from './chat-tools'
import ChatTurns from './chat-turns'

/** One page in three files: the tool blocks, whole turns, and the composer. */
export default function Chat() {
  return (
    <>
      <ChatTools />
      <ChatTurns />
      <ChatComposer />
    </>
  )
}
