import type { ComponentProps } from 'react'
import { cn } from '@/lib/utils'

interface AvatarProps extends ComponentProps<'span'> {
  src?: string
  alt?: string
  name?: string
  size?: 'sm' | 'md' | 'lg'
}

const sizeClasses = { sm: 'size-6 text-xs', md: 'size-8 text-sm', lg: 'size-10 text-base' }

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
      className={cn(
        'inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-default font-medium text-default-foreground',
        sizeClasses[size],
        className,
      )}
    >
      {children ??
        (src ? (
          <img data-slot="avatar-image" src={src} alt={alt ?? name ?? ''} className="size-full object-cover" />
        ) : (
          initials
        ))}
    </span>
  )
}

function AvatarImage({ className, ...props }: ComponentProps<'img'>) {
  return <img data-slot="avatar-image" {...props} className={cn('size-full object-cover', className)} />
}

function AvatarFallback({ className, ...props }: ComponentProps<'span'>) {
  return <span data-slot="avatar-fallback" {...props} className={cn('flex items-center justify-center', className)} />
}

export const Avatar = Object.assign(AvatarRoot, {
  Image: AvatarImage,
  Fallback: AvatarFallback,
})
