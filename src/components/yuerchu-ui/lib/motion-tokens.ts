/*
 * 动效 token 的唯一来源。
 *
 * - JS 动画（Motion）从这里取：用 lib/motion 里的 useMotionTokens()，它已经按"减弱动效"换好了值。
 * - tokens.css 里"动效"那一段和两份减弱动效的覆盖，由 docgen 从这里生成（pnpm docgen），不要手改那几段；
 *   pnpm docgen --check（提交前的钩子）发现两边对不上会报错。
 *
 * 这个文件只放数据，不依赖 React 和 Motion：docgen 也要读它。
 */

/** 时长，毫秒。CSS 里是 --dur-<名字>。 */
export const duration = {
  /** 按下 */
  instant: 120,
  /** 悬停颜色、退场 */
  fast: 160,
  /** 进场 */
  standard: 240,
  /** 宽高变化 */
  considered: 480,
  /** 加载图标转一圈；减弱模式下放慢，但不停（它表示进度，属于必要动效） */
  spin: 800,
  /** 骨架屏的闪光走一遍；纯装饰，减弱模式下为 0（停止） */
  shimmer: 1600,
  /** 变化提示（数字旁边浮出的 +18）停留多久；要留时间读，减弱模式下也不变 */
  linger: 1200,
  /** 标志墙这类横向滚动走一圈；纯装饰，减弱模式下为 0（不滚） */
  marquee: 40000,
  /** 轮播自动翻页的默认间隔；减弱模式为 0，关闭自动翻页。 */
  carousel: 5000,
} as const;

/** 缓动曲线（三次贝塞尔的四个控制点）。CSS 里是 --ease-<名字>。 */
export const ease = {
  /** 已经在屏幕上的东西变化：颜色、位置 */
  standard: [0.22, 1, 0.36, 1],
  /** 进场：先快后慢 */
  enter: [0.16, 1, 0.3, 1],
  /** 退场：先慢后快 */
  exit: [0.7, 0, 0.84, 0],
} as const satisfies Record<string, readonly [number, number, number, number]>;

/**
 * 弹簧：visualDuration 是"看起来到位"的时间（秒），bounce 是回弹的程度（0 不回弹）。
 * JS 里直接交给 Motion；CSS 里生成 --ease-spring（linear() 采样）和 --dur-spring（到完全静止的总时长）。
 * 用在位置和尺寸跟着内容变化、拖放后归位这类"已经在屏幕上、要移到新位置"的东西。
 *
 * bounce 为 0：开关、宽度、高度、进度、数值这些表示状态的东西，落位时不能冲过头——冲过头的那一下，
 * 屏幕上显示的是一个不真实的状态（开关滑过了头、宽度比内容还宽）。不冲过头也照样能被打断、反向。
 */
export const spring = { visualDuration: 0.35, bounce: 0 } as const;

/**
 * 加载状态的时机（毫秒）。不是动画，是"什么时候让用户看到在等"：减弱模式下也不变。DESIGN.md §7.4。
 * showDelay：数据这么久还没到才显示占位，更快到的直接出内容，不闪一下。
 * minVisible：占位（或"处理中"）一旦出现，至少停留这么久再换成结果。
 */
export const loading = { showDelay: 200, minVisible: 400 } as const;

/**
 * 逐个错开（stagger）的间隔，毫秒。DESIGN.md §5.2：总时长不超过约 400ms（staggerMax）。
 * char：逐字替换时新出现的字按阅读顺序一个比一个晚一点；line：多行占位的闪光一行比一行晚一点，读起来像一道波。
 */
export const stagger = { char: 16, line: 80 } as const;
/** 逐个错开的总时长上限，毫秒：再多的字也在这之内全部开始 */
export const staggerMax = 240;

/** 按下时缩小到的比例。CSS 里是 --press-scale。 */
export const pressScale = 0.97;
/** 弹层进场时从触发器方向移动的距离，px。CSS 里是 --enter-distance。 */
export const enterDistance = 4;
/** 弹层进场时的起始缩放。CSS 里是 --enter-scale。 */
export const enterScale = 0.98;
/** 内容替换（文字、图标换成别的）时新旧内容的模糊半径，px。CSS 里是 --swap-blur。 */
export const swapBlur = 4;
/** 内容替换时新内容从下方升起、旧内容向上离开的距离，px。CSS 里是 --swap-distance。 */
export const swapDistance = 4;
/** 内容替换时图标的起始缩放（新图标从这里放大到 1，旧图标缩到这里消失）。CSS 里是 --swap-scale。 */
export const swapScale = 0.6;

/**
 * 减弱动效时换掉的值（data-motion="reduced"，或跟随系统偏好）。
 * 原则：位移、缩放、尺寸变化去掉（时长为 0）；颜色和透明度的短过渡保留（instant、fast 不变），
 * 表示进度的加载图标放慢但不停。
 */
export const reduced = {
  duration: { standard: 0, considered: 0, spin: 1600, shimmer: 0, marquee: 0, carousel: 0 },
  /** 弹簧直接到位 */
  spring: "none",
  pressScale: 1,
  enterDistance: 0,
  enterScale: 1,
  swapBlur: 0,
  swapDistance: 0,
  swapScale: 1,
  /** 不错开：只剩淡入淡出时一起出现 */
  stagger: { char: 0, line: 0 },
} as const satisfies {
  duration: Partial<Record<keyof typeof duration, number>>;
  spring: "none";
  pressScale: number;
  enterDistance: number;
  enterScale: number;
  swapBlur: number;
  swapDistance: number;
  swapScale: number;
  stagger: Record<keyof typeof stagger, number>;
};
