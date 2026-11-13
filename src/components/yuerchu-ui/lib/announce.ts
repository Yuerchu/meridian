/*
 * 读屏播报。组件里"发生了一件看不见的事"（已复制、已发送、第 3 步完成…）都用它告诉读屏用户，
 * 不要在组件里自己放一个隐藏的 role="status"：
 * - 同一句话连续说两次时，隐藏元素的文字没有变化，第二次读屏不会读（"已发送"只读第一次）；
 * - 对话框打开时，对话框外面的内容对读屏隐藏，放在外面的 status 也就读不出来。
 *
 * 用 React Aria 自己的播报器：每条消息追加一个新节点（重复的也会读），并且打开对话框时它不会被隐藏
 * （React Aria 隐藏背景时会跳过它）。它只从 react-aria 的 private 路径导出；react-aria 的版本是锁定的，
 * 升级后路径变了会在类型检查和 test/announce.test.ts 里直接报错。
 */
import { announce as ariaAnnounce, clearAnnouncer } from "react-aria/private/live-announcer/LiveAnnouncer";

/**
 * 播报一句话。默认 polite（等读屏读完当前内容再读）；出错、需要立刻知道的用 assertive。
 */
export function announce(message: string, priority: "polite" | "assertive" = "polite") {
  if (!message) return;
  ariaAnnounce(message, priority);
}

/** 清掉还没读的播报（例如离开页面、内容已经过时）。 */
export function clearAnnouncements(priority: "polite" | "assertive" = "polite") {
  clearAnnouncer(priority);
}
