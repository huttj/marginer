// Highlight boxes for images. The CSS Custom Highlight API only paints text, so a
// quoted image is boxed by an absolutely-positioned, document-anchored <div> that
// scrolls with the page and is pointer-events:none (clicks fall through to the
// image, so it hit-tests like a text highlight). Both the on-page UI and the
// response panel render their image highlights this way, into their own layer.
export function syncImageOverlays(
  layer: HTMLElement,
  items: { img: HTMLImageElement; variant?: string }[],
): void {
  layer.querySelectorAll('.mg-imghl').forEach((n) => n.remove())
  for (const { img, variant } of items) {
    const rect = img.getBoundingClientRect()
    if (!rect.width || !rect.height) continue
    const d = document.createElement('div')
    d.className = 'mg-imghl' + (variant ? ' ' + variant : '')
    d.setAttribute('data-mg-ui', '')
    d.style.left = `${window.scrollX + rect.left}px`
    d.style.top = `${window.scrollY + rect.top}px`
    d.style.width = `${rect.width}px`
    d.style.height = `${rect.height}px`
    layer.appendChild(d)
  }
}
