import { defineStrings } from "../../lib/i18n";

export const fieldStrings = defineStrings(
  {
    valueMissing: "此项为必填。",
    typeMismatch: "格式不正确。",
    patternMismatch: "格式不符合要求。",
    tooShort: "内容太短。",
    tooLong: "内容太长。",
    rangeUnderflow: "数值太小。",
    rangeOverflow: "数值太大。",
    stepMismatch: "数值不符合步长要求。",
    badInput: "请输入有效的值。",
  },
  {
    valueMissing: "This field is required.",
    typeMismatch: "Enter a value in the right format.",
    patternMismatch: "Enter a value that matches the requested format.",
    tooShort: "This is too short.",
    tooLong: "This is too long.",
    rangeUnderflow: "This value is too small.",
    rangeOverflow: "This value is too large.",
    stepMismatch: "Enter a value that matches the step.",
    badInput: "Enter a valid value.",
  },
);
