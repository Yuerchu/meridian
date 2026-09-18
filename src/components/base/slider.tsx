import {
  Slider as AriaSlider,
  SliderTrack,
  SliderThumb,
  SliderOutput,
  type SliderProps as AriaSliderProps,
} from 'react-aria-components'
import { cx } from '@/utils/cx'

interface SliderProps extends AriaSliderProps {
  className?: string
}

function SliderRoot({ className, ...props }: SliderProps) {
  return (
    <AriaSlider data-slot="slider" {...props} className={cx('flex flex-col gap-2', className)}>
      <SliderTrack
        data-slot="slider-track"
        className="relative h-1.5 w-full rounded-full bg-background-tertiary-default"
      >
        <SliderThumb
          data-slot="slider-thumb"
          className="top-1/2 size-4 rounded-full border-2 border-accent-500 bg-background-primary-default shadow-xs"
        />
      </SliderTrack>
    </AriaSlider>
  )
}

function SliderFill({ className, ...props }: import('react').ComponentProps<'div'>) {
  return <div data-slot="slider-fill" {...props} className={cx('h-full rounded-full bg-accent-500', className)} />
}

export const Slider = Object.assign(SliderRoot, {
  Track: SliderTrack,
  Fill: SliderFill,
  Thumb: SliderThumb,
  Output: SliderOutput,
})
