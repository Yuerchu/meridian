import { defineStrings } from "../../lib/i18n";

export const passwordFieldStrings = defineStrings(
  {
    saved: "已保存密码，可直接提交；输入新密码将替换原密码。",
    hide: "隐藏密码",
    show: "显示密码",
    capsLock: "大写锁定已开启",
  },
  {
    saved: "A password is saved. Submit as is, or enter a new one to replace it.",
    hide: "Hide password",
    show: "Show password",
    capsLock: "Caps Lock is on",
  },
);
