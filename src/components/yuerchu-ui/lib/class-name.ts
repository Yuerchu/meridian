import { composeRenderProps } from "react-aria-components";

/**
 * 把组件自己的 `ui-*` 类名和使用者传入的 className 合并。
 * 使用者的 className 可以是字符串，也可以是 React Aria 的函数写法（接收渲染状态）。
 */
export function withUiClass<T>(
  uiClass: string,
  className: string | ((values: T & { defaultClassName: string | undefined }) => string) | undefined,
) {
  return composeRenderProps(className, (custom) => (custom ? `${uiClass} ${custom}` : uiClass));
}
