import * as React from "react"
import { dom, tv, type VariantProps } from "@heroui/react"

import { cn } from "@/lib/utils"

const markerVariants = tv({
  base: "group/marker relative flex min-h-4 w-full items-center gap-2 text-left text-sm text-muted [&_svg:not([class*='size-'])]:size-4 [a]:underline [a]:underline-offset-3 [a]:hover:text-foreground",
  variants: {
    variant: {
      default: "",
      separator:
        "before:mr-1 before:h-px before:min-w-0 before:flex-1 before:bg-border after:ml-1 after:h-px after:min-w-0 after:flex-1 after:bg-border",
      border: "border-b border-border pb-2",
    },
  },
})

function Marker({
  className,
  variant = "default",
  render,
  ...props
}: React.ComponentProps<typeof dom.div> & VariantProps<typeof markerVariants>) {
  return (
    <dom.div
      data-slot="marker"
      data-variant={variant}
      className={cn(markerVariants({ variant, className }))}
      render={render}
      {...props}
    />
  )
}

function MarkerIcon({ className, ...props }: React.ComponentProps<"span">) {
  return (
    <span
      data-slot="marker-icon"
      aria-hidden="true"
      // A direct child only. The descendant form reached inside HeroUI's
      // Spinner, whose markup is a sized span wrapping an unsized svg: the svg
      // matched, shrank to 16px, and parked in the corner of its 24px parent —
      // which is the element carrying the spin. The mark appeared to orbit
      // rather than turn. Anything nested deeper brings its own size.
      className={cn(
        "size-4 shrink-0 [&>svg:not([class*='size-'])]:size-4",
        className
      )}
      {...props}
    />
  )
}

function MarkerContent({ className, ...props }: React.ComponentProps<"span">) {
  return (
    <span
      data-slot="marker-content"
      className={cn(
        "min-w-0 wrap-break-word group-data-[variant=separator]/marker:flex-none group-data-[variant=separator]/marker:text-center *:[a]:underline *:[a]:underline-offset-3 *:[a]:hover:text-foreground",
        className
      )}
      {...props}
    />
  )
}

export { Marker, MarkerIcon, MarkerContent, markerVariants }
