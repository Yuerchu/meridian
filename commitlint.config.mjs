export default {
  extends: ['@commitlint/config-conventional'],
  rules: {
    // 历史提交的 subject 是英文小写句子,规则与之对齐;body 不限行宽,
    // 因为改动说明经常引用整行代码或 URL。
    'body-max-line-length': [0],
  },
}
