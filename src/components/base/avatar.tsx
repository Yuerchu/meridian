import type { ComponentProps } from 'react'
import { cx } from '@/utils/cx'

type AvatarSize = 'xs' | 'sm' | 'md' | 'lg'

interface AvatarProps extends ComponentProps<'span'> {
  src?: string
  alt?: string
  name?: string
  size?: AvatarSize
}

const sizeClasses = {
  xs: 'size-5 text-[10px] leading-[15px] font-semibold',
  sm: 'size-6 text-caption-1-semibold tracking-normal',
  md: 'size-8 text-headline-semibold',
  lg: 'size-9 text-[18px] leading-6 font-semibold',
}

function AvatarRoot({ className, src, alt, name, size = 'md', children, ...props }: AvatarProps) {
  const initials = name
    ?.split(' ')
    .map((w) => w[0])
    .join('')
    .slice(0, 2)
    .toUpperCase()
  return (
    <span
      data-slot="avatar"
      {...props}
      className={cx(
        'inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full',
        'bg-avatar-neutral-background text-text-secondary',
        'select-none align-middle transition-[width,height,font-size] duration-200 ease',
        sizeClasses[size],
        className,
      )}
    >
      {children ??
        (src ? (
          <img
            data-slot="avatar-image"
            src={src}
            alt={alt ?? name ?? ''}
            loading="lazy"
            decoding="async"
            className="size-full object-cover"
          />
        ) : (
          initials
        ))}
    </span>
  )
}

function AvatarImage({ className, ...props }: ComponentProps<'img'>) {
  return <img data-slot="avatar-image" {...props} className={cx('size-full object-cover', className)} />
}

function AvatarFallback({ className, ...props }: ComponentProps<'span'>) {
  return <span data-slot="avatar-fallback" {...props} className={cx('flex items-center justify-center', className)} />
}

export const Avatar = Object.assign(AvatarRoot, {
  Image: AvatarImage,
  Fallback: AvatarFallback,
})
