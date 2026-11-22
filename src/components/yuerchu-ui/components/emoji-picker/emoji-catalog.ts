import type { EmojiData } from "frimousse";

/** 字面量动态导入：registry 安装后仍由消费端打包器按语言拆包，不请求第三方数据。 */
export async function loadEmojiCatalog(locale: string): Promise<EmojiData> {
  return locale === "zh" ? (await import("./emoji-data-zh")).default : (await import("./emoji-data-en")).default;
}
