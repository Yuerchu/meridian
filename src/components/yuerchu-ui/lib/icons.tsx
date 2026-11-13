"use client";

/*
 * 组件库内置图标。源文件来自 Keyline Icons（stroke 圆角版，MIT，见同目录 icons.LICENSE）。
 * 只放组件内部要用的图标；业务代码请直接使用 @keyline-icons/react。
 * 图标一律是装饰性的：aria-hidden，尺寸和颜色由组件 CSS 控制（--icon-size、currentColor）。
 */

import type { ReactNode, SVGProps } from "react";

type IconProps = Omit<SVGProps<SVGSVGElement>, "children">;

function Svg({ children, ...props }: IconProps & { children: ReactNode }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...props}
    >
      {children}
    </svg>
  );
}

export function ChevronDownIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M6 9L12 15L18 9" />
    </Svg>
  );
}

export function ChevronUpIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M6 15L12 9L18 15" />
    </Svg>
  );
}

export function ChevronLeftIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M15 6L9 12L15 18" />
    </Svg>
  );
}

export function ChevronRightIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M9 6L15 12L9 18" />
    </Svg>
  );
}

export function CalendarIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M6 5H18C19.6569 5 21 6.34315 21 8V18C21 19.6569 19.6569 21 18 21H6C4.34315 21 3 19.6569 3 18V8C3 6.34315 4.34315 5 6 5ZM7 11H17M8 3V7M16 3V7" />
    </Svg>
  );
}

export function CheckIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M5 12L9.66667 17L19 7" />
    </Svg>
  );
}

export function PlusIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M5 12H19M11.995 19.005V5.005" />
    </Svg>
  );
}

export function MinusIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M5 12H19" />
    </Svg>
  );
}

export function XIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M7 7L17 17M17 7L7 17" />
    </Svg>
  );
}

export function SpinnerIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M22 12C22 17.5228 17.5228 22 12 22C6.47715 22 2 17.5228 2 12C2 6.47715 6.47715 2 12 2" />
    </Svg>
  );
}

export function EyeIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M2 12C3.0523 7.3229 7.206 4 12 4C16.794 4 20.9477 7.3229 22 12C20.9477 16.6771 16.794 20 12 20C7.206 20 3.0523 16.6771 2 12ZM15 12C15 13.6569 13.6569 15 12 15C10.3431 15 9 13.6569 9 12C9 10.3431 10.3431 9 12 9C13.6569 9 15 10.3431 15 12Z" />
    </Svg>
  );
}

export function EyeOffIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M18.035 18.035C16.3283 19.2786 14.2337 20 12 20C7.206 20 3.0523 16.6771 2 12C2.562 9.5021 4.0086 7.3904 5.965 5.965M9.8779 4.2211C10.565 4.076 11.2752 4 12 4C16.794 4 20.9477 7.3229 22 12C21.7487 13.1169 21.3206 14.1566 20.7491 15.0922M14.1213 14.1213C13.5785 14.6642 12.8285 15 12 15C10.3431 15 9 13.6569 9 12C9 11.1716 9.3358 10.4216 9.8787 9.8787M2 2L22 22" />
    </Svg>
  );
}

export function InfoIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M12 2C17.5228 2 22 6.47715 22 12C22 17.5228 17.5228 22 12 22C6.47715 22 2 17.5228 2 12C2 6.47715 6.47715 2 12 2Z" />
      <path d="M12 12V16" />
      <path d="M13 8C13 8.5523 12.5523 9 12 9C11.4477 9 11 8.5523 11 8C11 7.4477 11.4477 7 12 7C12.5523 7 13 7.4477 13 8Z" fill="currentColor" stroke="none" />
    </Svg>
  );
}

export function AlertIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M12 5V15" />
      <path d="M13 19C13 19.55228 12.55228 20 12 20C11.44772 20 11 19.55228 11 19C11 18.44772 11.44772 18 12 18C12.55228 18 13 18.44772 13 19Z" fill="currentColor" stroke="none" />
    </Svg>
  );
}

export function CircleCheckIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M12 2C17.5228 2 22 6.47715 22 12C22 17.5228 17.5228 22 12 22C6.47715 22 2 17.5228 2 12C2 6.47715 6.47715 2 12 2Z" />
      <path d="M8 12L10.6667 15L16 9" />
    </Svg>
  );
}

export function CopyIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M15.8284 4C15.4046 2.8015 14.2714 2 13 2H5C3.34315 2 2 3.34315 2 5V13C2 14.2714 2.8015 15.4046 4 15.8284M11 8H19C20.65684 8 22 9.34316 22 11V19C22 20.65684 20.65684 22 19 22H11C9.34316 22 8 20.65684 8 19V11C8 9.34316 9.34316 8 11 8Z" />
    </Svg>
  );
}

export function SearchIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M17 10C17 13.866 13.866 17 10 17C6.13401 17 3 13.866 3 10C3 6.13401 6.13401 3 10 3C13.866 3 17 6.13401 17 10ZM15 15L21 21" />
    </Svg>
  );
}

export function ArrowUpRightIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M6 6H17.5C17.77614 6 18 6.22386 18 6.5V18M7.2 16.8L17.4 6.6" />
    </Svg>
  );
}

export function MenuIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M4 6H20M4 12H20M4 18H20" />
    </Svg>
  );
}

/** 侧边栏（收起 / 展开侧边栏的按钮） */
export function PanelLeftIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M5 4H19C20.1046 4 21 4.89543 21 6V18C21 19.1046 20.1046 20 19 20H5C3.89543 20 3 19.1046 3 18V6C3 4.89543 3.89543 4 5 4ZM9 4V20" />
    </Svg>
  );
}

export function UploadIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M12 14V3M8 7L12 3L16 7M4 18V19C4 20.1046 4.89543 21 6 21H18C19.1046 21 20 20.1046 20 19V18" />
    </Svg>
  );
}

/** 下载（和上传同一套线条：托盘不动，箭头朝下） */
export function DownloadIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M12 3V14M8 10L12 14L16 10M4 18V19C4 20.1046 4.89543 21 6 21H18C19.1046 21 20 20.1046 20 19V18" />
    </Svg>
  );
}

/** 三个点（"更多"菜单）。原图是填充的，不是描边 */
export function MoreIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path
        d="M7 12C7 13.1045 6.1045 14 5 14C3.8955 14 3 13.1045 3 12C3 10.8955 3.8955 10 5 10C6.1045 10 7 10.8955 7 12ZM14 12C14 13.1045 13.1045 14 12 14C10.8955 14 10 13.1045 10 12C10 10.8955 10.8955 10 12 10C13.1045 10 14 10.8955 14 12ZM21 12C21 13.1045 20.1045 14 19 14C17.8955 14 17 13.1045 17 12C17 10.8955 17.8955 10 19 10C20.1045 10 21 10.8955 21 12Z"
        fill="currentColor"
        stroke="none"
      />
    </Svg>
  );
}

/** 赞 */
export function ThumbsUpIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M4 10L8 10L9.6213 3.5149C9.8439 2.6246 10.6438 2 11.5616 2L13.2344 2C14.2431 2 15.0939 2.7511 15.219 3.7519L16 10L20 10C21.1046 10 22 10.8954 22 12C22 12.2398 21.9569 12.4777 21.8727 12.7022L18.8727 20.7022C18.5799 21.4829 17.8337 22 17 22L4 22C2.8954 22 2 21.1046 2 20L2 12C2 10.8954 2.8954 10 4 10ZM8 10L8 22" />
    </Svg>
  );
}

/** 踩 */
export function ThumbsDownIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M20 14L16 14L14.3787 20.4851C14.1561 21.3754 13.3562 22 12.4384 22L10.7656 22C9.7569 22 8.9061 21.2489 8.781 20.2481L8 14L4 14C2.8954 14 2 13.1046 2 12C2 11.7602 2.0431 11.5223 2.1273 11.2978L5.1273 3.2978C5.4201 2.5171 6.1663 2 7 2L20 2C21.1046 2 22 2.8954 22 4L22 12C22 13.1046 21.1046 14 20 14ZM16 14L16 2" />
    </Svg>
  );
}

/** 重新生成（逆时针箭头） */
export function RegenerateIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M3.2117 10.0593C3.071 10.6966 3 11.3473 3 12C3 16.9706 7.0294 21 12 21C16.9706 21 21 16.9706 21 12C21 7.0294 16.9706 3 12 3C9.5169 3 7.1441 4.0259 5.4432 5.8349M4.2857 3L4.7293 6.105C4.7683 6.3784 5.0216 6.5683 5.295 6.5293L8.4 6.0857" />
    </Svg>
  );
}

/** 顺时针旋转（重新生成图标的水平镜像） */
export function RotateCwIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path transform="matrix(-1 0 0 1 24 0)" d="M3.2117 10.0593C3.071 10.6966 3 11.3473 3 12C3 16.9706 7.0294 21 12 21C16.9706 21 21 16.9706 21 12C21 7.0294 16.9706 3 12 3C9.5169 3 7.1441 4.0259 5.4432 5.8349M4.2857 3L4.7293 6.105C4.7683 6.3784 5.0216 6.5683 5.295 6.5293L8.4 6.0857" />
    </Svg>
  );
}

/** 链接 */
export function LinkIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M8.1883 18.4383C7.5084 19.1181 6.5864 19.5 5.625 19.5C4.6636 19.5 3.7416 19.1181 3.0617 18.4383C2.3819 17.7584 2 16.8364 2 15.875C2 14.9136 2.3819 13.9916 3.0617 13.3117L8.1867 8.1867C8.8666 7.5069 9.7886 7.125 10.75 7.125C11.7114 7.125 12.6334 7.5069 13.3133 8.1867C13.9931 8.8666 14.375 9.7886 14.375 10.75C14.375 11.7114 13.9931 12.6334 13.3133 13.3133M15.8117 5.5617C16.4916 4.8819 17.4136 4.5 18.375 4.5C19.3364 4.5 20.2584 4.8819 20.9383 5.5617C21.6181 6.2416 22 7.1636 22 8.125C22 9.0864 21.6181 10.0084 20.9383 10.6883L15.8133 15.8133C15.1334 16.4931 14.2114 16.875 13.25 16.875C12.2886 16.875 11.3666 16.4931 10.6867 15.8133C10.0069 15.1334 9.625 14.2114 9.625 13.25C9.625 12.2886 10.0069 11.3666 10.6867 10.6867" />
    </Svg>
  );
}

/** 收缩（更简洁） */
export function MinimizeIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M9 3V6C9 7.65685 7.65685 9 6 9H3M15 3V6C15 7.65685 16.34315 9 18 9H21M21 15H18C16.34315 15 15 16.34315 15 18V21M3 15H6C7.65685 15 9 16.34315 9 18V21" />
    </Svg>
  );
}

/** 展开（更详细） */
export function MaximizeIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M9 3H6C4.34315 3 3 4.34315 3 6V9M15 3H18C19.65685 3 21 4.34315 21 6V9M21 15V18C21 19.65685 19.65685 21 18 21H15M3 15V18C3 19.65685 4.34315 21 6 21H9" />
    </Svg>
  );
}

/** 向上箭头（发送） */
export function ArrowUpIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M5 11.8771L11.5875 5.17385C11.8153 4.94205 12.1847 4.94205 12.4125 5.17385L19 11.8771M12 19V5.94129" />
    </Svg>
  );
}

/** 回形针（附件） */
export function PaperclipIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M15.6716 6.8536L8.0126 14.5125C7.3292 15.1959 7.3292 16.304 8.0126 16.9874C8.696 17.6708 9.8041 17.6708 10.4875 16.9874L18.5 8.9749C19.8668 7.608 19.8668 5.392 18.5 4.0251C17.1332 2.6583 14.9171 2.6583 13.5503 4.0251L5.5377 12.0377C3.4875 14.0879 3.4874 17.4119 5.5377 19.4623C7.5881 21.5126 10.9121 21.5125 12.9623 19.4623L20 12.4246" />
    </Svg>
  );
}

/** 圆圈里的感叹号（失败状态） */
export function CircleAlertIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M22 12C22 17.52285 17.52285 22 12 22C6.47715 22 2 17.52285 2 12C2 6.47715 6.47715 2 12 2C17.52285 2 22 6.47715 22 12Z" />
      <path d="M12 7V13" />
      <path d="M13 17C13 17.55228 12.55228 18 12 18C11.44772 18 11 17.55228 11 17C11 16.44772 11.44772 16 12 16C12.55228 16 13 16.44772 13 17Z" fill="currentColor" stroke="none" />
    </Svg>
  );
}

/** 三角形里的感叹号（警告）。和 CircleAlertIcon（危险）形状不同：两种语气不只靠颜色区分 */
export function TriangleAlertIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M14.4051 4.39215C13.3181 2.53595 10.6819 2.53595 9.5949 4.39215L2.40063 16.6777C1.28536 18.5822 2.63072 21 4.80572 21H19.1943C21.3693 21 22.7146 18.5822 21.5994 16.6777L14.4051 4.39215Z" />
      <path d="M12 9V13" />
      <path d="M13 17C13 17.5523 12.5523 18 12 18C11.4477 18 11 17.5523 11 17C11 16.4477 11.4477 16 12 16C12.5523 16 13 16.4477 13 17Z" fill="currentColor" stroke="none" />
    </Svg>
  );
}

/** 笔（编辑） */
export function PenIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M21.0237 7.6904L9.8567 18.8573L2 22L5.1427 14.1433L16.3096 2.9763C16.9348 2.3512 17.7826 2 18.6667 2C19.5507 2 20.3986 2.3512 21.0237 2.9763C21.6488 3.6014 22 4.4493 22 5.3333C22 6.2174 21.6488 7.0652 21.0237 7.6904ZM15.0638 4.2222L19.7778 8.9362" fill="none" />
    </Svg>
  );
}

/** 盾牌里一个勾（已授权） */
export function ShieldCheckIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M5.18251 5.16845C7.83034 4.85425 9.82952 3.53222 11.0242 2.37315C11.537 1.87562 12.463 1.87562 12.9758 2.37315C14.1705 3.53222 16.1697 4.85425 18.8175 5.16845C19.4672 5.24554 20 5.75056 20 6.38285V12.5708C20 14.3452 19.7111 16.1513 18.612 17.5729C17.4097 19.1277 15.5033 20.8703 12.8298 21.8525C12.2945 22.0492 11.7055 22.0492 11.1702 21.8525C8.49668 20.8703 6.59026 19.1277 5.38804 17.5729C4.28885 16.1513 4 14.3452 4 12.5708V6.38285C4 5.75056 4.53284 5.24554 5.18251 5.16845ZM8 12L10.6667 15L16 9" />
    </Svg>
  );
}

/** 播放（开始 / 继续） */
export function PlayIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M6 6C6 5.2291 6.4431 4.5268 7.1389 4.1949C7.8347 3.8629 8.6593 3.9605 9.2585 4.4456L17.6292 11.2228C17.8638 11.4127 18 11.6983 18 12C18 12.3017 17.8638 12.5873 17.6292 12.7772L9.2585 19.5544C8.6593 20.0395 7.8347 20.1371 7.1389 19.8051C6.4431 19.4732 6 18.7709 6 18Z" />
    </Svg>
  );
}

/** 暂停 */
export function PauseIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M5 5C5 4.447715 5.447715 4 6 4L8 4C8.552285 4 9 4.447715 9 5L9 19C9 19.552285 8.552285 20 8 20L6 20C5.447715 20 5 19.552285 5 19ZM15 5C15 4.447715 15.447715 4 16 4L18 4C18.552285 4 19 4.447715 19 5L19 19C19 19.552285 18.552285 20 18 20L16 20C15.447715 20 15 19.552285 15 19Z" />
    </Svg>
  );
}

/** 圆圈里一个叉（失败） */
export function CircleXIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M12 2C17.5228 2 22 6.47715 22 12C22 17.5228 17.5228 22 12 22C6.47715 22 2 17.5228 2 12C2 6.47715 6.47715 2 12 2Z" />
      <path d="M9 9L15 15M15 9L9 15" />
    </Svg>
  );
}

/** 跳过 */
export function SkipForwardIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M5 7.0059C5 5.271102 7.057553 4.358975 8.343026 5.523914L14.671513 11.259007C15.109496 11.655922 15.109496 12.344078 14.671513 12.740993L8.343026 18.476086C7.057553 19.641025 5 18.728898 5 16.9941ZM19 5V19" />
    </Svg>
  );
}

/** 虚线圆圈（未开始） */
export function CircleDashedIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M21.8769 10.4357C22.041 11.4721 22.041 12.5279 21.8769 13.5643M20.0902 17.8778C19.4734 18.7268 18.7268 19.4734 17.8778 20.0902M13.5643 21.8769C12.5279 22.041 11.4721 22.041 10.4357 21.8769M6.12215 20.0902C5.2732 19.4734 4.52663 18.7268 3.90983 17.8778M2.12312 13.5643C1.95896 12.5279 1.95896 11.4721 2.12312 10.4357M3.90983 6.12215C4.52663 5.2732 5.2732 4.52663 6.12215 3.90983M10.4357 2.12312C11.4721 1.95896 12.5279 1.95896 13.5643 2.12312M17.8778 3.90983C18.7268 4.52663 19.4734 5.2732 20.0902 6.12215" />
    </Svg>
  );
}

/** 拖动手柄（两列圆点） */
export function GripIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M10 5C10 5.5523 9.5523 6 9 6C8.4477 6 8 5.5523 8 5C8 4.4477 8.4477 4 9 4C9.5523 4 10 4.4477 10 5ZM10 12C10 12.5523 9.5523 13 9 13C8.4477 13 8 12.5523 8 12C8 11.4477 8.4477 11 9 11C9.5523 11 10 11.4477 10 12ZM10 19C10 19.5523 9.5523 20 9 20C8.4477 20 8 19.5523 8 19C8 18.4477 8.4477 18 9 18C9.5523 18 10 18.4477 10 19ZM16 5C16 5.5523 15.5523 6 15 6C14.4477 6 14 5.5523 14 5C14 4.4477 14.4477 4 15 4C15.5523 4 16 4.4477 16 5ZM16 12C16 12.5523 15.5523 13 15 13C14.4477 13 14 12.5523 14 12C14 11.4477 14.4477 11 15 11C15.5523 11 16 11.4477 16 12ZM16 19C16 19.5523 15.5523 20 15 20C14.4477 20 14 19.5523 14 19C14 18.4477 14.4477 18 15 18C15.5523 18 16 18.4477 16 19Z" />
    </Svg>
  );
}

/** 铃铛（通知） */
export function BellIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M12 3C14.7614 3 17 5.23858 17 8C17 13 19 14 19 15C19 15.5523 18.5523 16 18 16H6C5.44772 16 5 15.5523 5 15C5 14 7 13 7 8C7 5.23858 9.23858 3 12 3ZM10.2679 20C10.6252 20.6188 11.2855 21 12 21C12.7145 21 13.3748 20.6188 13.7321 20" />
    </Svg>
  );
}

/** 锁（付费、隐藏内容）。按同样的 2px 圆角描边画的 */
export function LockIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M6 11H18C18.5523 11 19 11.4477 19 12V20C19 20.5523 18.5523 21 18 21H6C5.44772 21 5 20.5523 5 20V12C5 11.4477 5.44772 11 6 11ZM8 11V7C8 4.79086 9.79086 3 12 3C14.2091 3 16 4.79086 16 7V11M12 15V17" />
    </Svg>
  );
}

/** 收藏（星）。按同样的 2px 圆角描边画的 */
export function StarIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M12 3L14.78 8.63L21 9.54L16.5 13.93L17.56 20.12L12 17.2L6.44 20.12L7.5 13.93L3 9.54L9.22 8.63L12 3Z" />
    </Svg>
  );
}

/** 打赏（礼物）。按同样的 2px 圆角描边画的 */
export function GiftIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M4 11H20V20C20 20.5523 19.5523 21 19 21H5C4.44772 21 4 20.5523 4 20V11ZM3 7H21V11H3V7ZM12 7V21M12 7C12 7 11 3 8.5 3C7.11929 3 6 4.11929 6 5.5C6 6.88071 7.11929 7 8.5 7M12 7C12 7 13 3 15.5 3C16.8807 3 18 4.11929 18 5.5C18 6.88071 16.8807 7 15.5 7" />
    </Svg>
  );
}

/** 分享（箭头从盒子里出来）。按同样的 2px 圆角描边画的 */
export function ShareIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M12 3V15M8 7L12 3L16 7M5 12V19C5 19.5523 5.44772 20 6 20H18C18.5523 20 19 19.5523 19 19V12" />
    </Svg>
  );
}

/** 评论（对话气泡）。按同样的 2px 圆角描边画的 */
export function MessageIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M4 5C4 4.44772 4.44772 4 5 4H19C19.5523 4 20 4.44772 20 5V16C20 16.5523 19.5523 17 19 17H10L6 20V17H5C4.44772 17 4 16.5523 4 16V5Z" />
    </Svg>
  );
}

/** 时钟（限时允许、到期）。Keyline 里没有现成的，按同样的 2px 圆角描边画的 */
export function ClockIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7V12L15 14" />
    </Svg>
  );
}

/** 拐向右下的箭头（给任务的指示：从输入框转到某一步）。按同样的 2px 圆角描边画的 */
export function CornerDownRightIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M5 4V11C5 12.6569 6.34315 14 8 14H19M15 10L19 14L15 18" />
    </Svg>
  );
}

/** 上一首（跳过图标的水平镜像） */
export function SkipBackIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path transform="matrix(-1 0 0 1 24 0)" d="M5 7.0059C5 5.271102 7.057553 4.358975 8.343026 5.523914L14.671513 11.259007C15.109496 11.655922 15.109496 12.344078 14.671513 12.740993L8.343026 18.476086C7.057553 19.641025 5 18.728898 5 16.9941ZM19 5V19" />
    </Svg>
  );
}

/** 喇叭（朗读）。按同样的 2px 圆角描边画的 */
export function SpeakerIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M4 9.5V14.5C4 15.0523 4.44772 15.5 5 15.5H8L12.4 19.02C13.0548 19.5438 14 19.0776 14 18.2391V5.76091C14 4.92238 13.0548 4.45618 12.4 4.97999L8 8.5H5C4.44772 8.5 4 8.94772 4 9.5ZM17.5 9C18.1667 9.66667 18.5 10.6667 18.5 12C18.5 13.3333 18.1667 14.3333 17.5 15" />
    </Svg>
  );
}

/** 停止（实心圆角方块的描边版） */
export function StopIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <rect x="6" y="6" width="12" height="12" rx="2" />
    </Svg>
  );
}
