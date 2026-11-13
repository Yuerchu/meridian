/*
 * 从渲染好的 DOM 量出骨架：文字一行一条，图片、按钮、输入框、小色块（徽标、标签）一个块。
 * Reveal 的 sample（用示例数据隐藏着渲染一遍）和"记住的形状"（上次显示的内容）都用它。
 * 量不准的地方用 data-skeleton 提示：data-skeleton="block" 画成一整块，data-skeleton="ignore" 不画。
 */

export interface Bone {
  /** 相对容器左上角的位置和尺寸（px） */
  x: number;
  y: number;
  width: number;
  height: number;
  /** text：一行文字（只画字号那么高，不含行距）；block：块，带它自己的圆角 */
  kind: "text" | "block";
  /** block 的圆角（computed border-radius） */
  radius?: string;
}

export interface Shape {
  bones: Bone[];
  width: number;
  height: number;
}

/** 这些元素整体画成一块，不再往里量 */
const BLOCK_TAGS = new Set(["IMG", "SVG", "VIDEO", "CANVAS", "PICTURE", "INPUT", "TEXTAREA", "SELECT", "BUTTON", "IFRAME"]);
/** 有底色或边框、又不大的元素（徽标、标签、头像）画成一块；更大的（卡片、面板）往里量 */
const SMALL_BLOCK = { width: 320, height: 48 };

const isTransparent = (color: string) => color === "transparent" || /rgba\(.*,\s*0\)$/.test(color) || /\/\s*0\)$/.test(color);

function looksLikeBlock(el: Element, style: CSSStyleDeclaration, rect: DOMRect) {
  const hint = el.getAttribute("data-skeleton");
  if (hint === "block") return true;
  if (BLOCK_TAGS.has(el.tagName.toUpperCase())) return true;
  const role = el.getAttribute("role");
  if (role === "img" || role === "progressbar" || role === "meter") return true;
  const painted = !isTransparent(style.backgroundColor) || (parseFloat(style.borderTopWidth) > 0 && !isTransparent(style.borderTopColor));
  return painted && rect.width <= SMALL_BLOCK.width && rect.height <= SMALL_BLOCK.height;
}

/** 同一行、挨着的文字片段（加粗、链接把一行拆成几段）合成一条 */
function mergeLine(bones: Bone[], next: Bone) {
  const last = bones[bones.length - 1];
  if (last && last.kind === "text" && Math.abs(last.y - next.y) < 1 && Math.abs(last.height - next.height) < 2 && next.x - (last.x + last.width) < 12 && next.x >= last.x) {
    last.width = next.x + next.width - last.x;
    return;
  }
  bones.push(next);
}

export function traceShape(root: HTMLElement): Shape {
  const origin = root.getBoundingClientRect();
  const bones: Bone[] = [];
  const at = (r: DOMRect) => ({ x: r.left - origin.left, y: r.top - origin.top, width: r.width, height: r.height });

  const walk = (node: Node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      if (!node.textContent?.trim()) return;
      const range = document.createRange();
      range.selectNodeContents(node);
      for (const r of range.getClientRects()) if (r.width >= 1 && r.height >= 1) mergeLine(bones, { ...at(r), kind: "text" });
      return;
    }
    if (!(node instanceof Element)) return;
    if (node.getAttribute("data-skeleton") === "ignore") return;
    const style = getComputedStyle(node);
    if (style.display === "none" || style.visibility === "collapse") return;
    const rect = node.getBoundingClientRect();
    if (rect.width < 1 || rect.height < 1) return;
    if (looksLikeBlock(node, style, rect)) {
      bones.push({ ...at(rect), kind: "block", radius: style.borderRadius });
      return;
    }
    for (const child of node.childNodes) walk(child);
  };
  for (const child of root.childNodes) walk(child);
  return { bones, width: origin.width, height: origin.height };
}
