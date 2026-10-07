import ChatComposer from './chat-composer'
import ChatParts from './chat-parts'
import ChatTools from './chat-tools'
import ChatTurns from './chat-turns'

/** One page in four files: the tool blocks, whole turns, the composer, and the parts they are built from. */
export default function Chat() {
  return (
    <>
      <ChatTools />
      <ChatTurns />
      <ChatComposer />
      <ChatParts />
    </>
  )
}
