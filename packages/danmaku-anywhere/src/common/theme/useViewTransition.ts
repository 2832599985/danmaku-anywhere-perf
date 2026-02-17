import { useCallback } from 'react'

/**
 * Provides a helper that wraps a DOM mutation in a View Transition
 * (circular clip-path expansion from the click origin).
 *
 * Falls back to an immediate call when the API is unavailable.
 */
export const useViewTransition = () => {
  const startTransition = useCallback(
    (event: React.MouseEvent, callback: () => void) => {
      if (!document.startViewTransition) {
        callback()
        return
      }

      const x = event.clientX
      const y = event.clientY

      // Calculate the maximum radius needed to cover the entire viewport
      const endRadius = Math.hypot(
        Math.max(x, window.innerWidth - x),
        Math.max(y, window.innerHeight - y)
      )

      const transition = document.startViewTransition(() => {
        callback()
      })

      transition.ready.then(() => {
        document.documentElement.animate(
          {
            clipPath: [
              `circle(0px at ${x}px ${y}px)`,
              `circle(${endRadius}px at ${x}px ${y}px)`,
            ],
          },
          {
            duration: 400,
            easing: 'ease-out',
            pseudoElement: '::view-transition-new(root)',
          }
        )
      })
    },
    []
  )

  return { startTransition }
}
