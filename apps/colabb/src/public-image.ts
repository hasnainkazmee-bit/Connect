// Only same-origin public company assets support resizing. Never rewrite
// private attachments or proxy an arbitrary external image URL.
export function publicImage(src: string, width: 96 | 192 | 384 | 768 | 1280) {
  return /^\/api\/company-assets\/[\da-f-]{36}$/i.test(src)
    ? `${src}?width=${width}`
    : src;
}
