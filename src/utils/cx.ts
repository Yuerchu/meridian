import { clsx, type ClassValue } from 'clsx'
import { extendTailwindMerge } from 'tailwind-merge'

const twMerge = extendTailwindMerge({
  extend: {
    classGroups: {
      'font-size': [
        {
          text: [
            'large-title-regular',
            'large-title-medium',
            'large-title-semibold',
            'large-title-bold',
            'title-1-regular',
            'title-1-medium',
            'title-1-semibold',
            'title-1-bold',
            'title-2-regular',
            'title-2-medium',
            'title-2-semibold',
            'title-2-bold',
            'title-3-regular',
            'title-3-medium',
            'title-3-semibold',
            'title-3-bold',
            'headline-regular',
            'headline-medium',
            'headline-semibold',
            'headline-bold',
            'body-regular',
            'body-medium',
            'body-semibold',
            'body-bold',
            'callout-regular',
            'callout-medium',
            'callout-semibold',
            'callout-bold',
            'subheadline-regular',
            'subheadline-medium',
            'subheadline-semibold',
            'subheadline-bold',
            'footnote-regular',
            'footnote-medium',
            'footnote-semibold',
            'footnote-bold',
            'caption-1-regular',
            'caption-1-medium',
            'caption-1-semibold',
            'caption-1-bold',
            'caption-2-regular',
            'caption-2-medium',
            'caption-2-semibold',
            'caption-2-bold',
            'overline-regular',
            'overline-medium',
            'overline-semibold',
            'overline-bold',
            'code-regular',
            'code-medium',
            'code-semibold',
            'code-bold',
          ],
        },
      ],
    },
  },
})

export function cx(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}
