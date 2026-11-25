import * as React from 'react'

import './marker.css'

export type MarkerVariant = 'default' | 'separator' | 'border'

function joinClasses(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(' ')
}

function Marker({
  className,
  variant = 'default',
  render,
  ...props
}: React.ComponentProps<'div'> & {
  variant?: MarkerVariant
  render?: (props: React.ComponentProps<'div'>) => React.ReactElement
}) {
  const domProps: React.ComponentProps<'div'> & { 'data-slot': string; 'data-variant': MarkerVariant } = {
    'data-slot': 'marker',
    'data-variant': variant,
    className: joinClasses('m-marker', className),
    ...props,
  }
  if (render) return render(domProps)
  return <div {...domProps} />
}

function MarkerIcon({ className, ...props }: React.ComponentProps<'span'>) {
  return (
    <span data-slot="marker-icon" aria-hidden="true" className={joinClasses('m-marker__icon', className)} {...props} />
  )
}

function MarkerContent({ className, ...props }: React.ComponentProps<'span'>) {
  return <span data-slot="marker-content" className={joinClasses('m-marker__content', className)} {...props} />
}

export { Marker, MarkerIcon, MarkerContent }
