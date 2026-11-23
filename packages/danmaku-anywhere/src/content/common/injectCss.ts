export const injectCss = (container: HTMLElement, css: string[]) => {
  const injected: HTMLElement[] = []

  css.forEach((css) => {
    const style = document.createElement('style')
    // textContent, never innerHTML: innerHTML parses a <style> body in RAWTEXT
    // mode, so a `</style>` inside user-supplied CSS would end the raw text and
    // turn the rest into live elements inside the shadow tree.
    style.textContent = css
    container.appendChild(style)
    injected.push(style)
  })

  return injected
}
