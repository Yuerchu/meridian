import { defineStrings } from "../../lib/i18n";

export const thinkingStateStrings = defineStrings(
  {
    thinkingFor: (v: { time: string }) => `思考中 · ${v.time}`,
    thinking: "思考中…",
    stoppedWhile: "思考已停止",
    thoughtFor: (v: { time: string }) => `已思考 ${v.time}`,
    thought: "已完成思考",
    stopped: "已停止思考",
    doneIn: (v: { time: string }) => `思考完成，用时 ${v.time}`,
    done: "思考完成",
  },
  {
    thinkingFor: (v: { time: string }) => `Thinking · ${v.time}`,
    thinking: "Thinking…",
    stoppedWhile: "Stopped thinking",
    thoughtFor: (v: { time: string }) => `Thought for ${v.time}`,
    thought: "Finished thinking",
    stopped: "Stopped thinking",
    doneIn: (v: { time: string }) => `Done thinking in ${v.time}`,
    done: "Done thinking",
  },
);
