// Shared by the client and server-rendered marketing pages.
export function marketingPhoto(key: string, alt: string) {
  const name = ["roof", "planning", "detail", "craft"].includes(key)
    ? key
    : "roof";
  const escaped = alt.replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );
  const width = name === "craft" ? 1440 : 1536;
  const src = `/brand/photos/${name}-v1`;
  return `<img src="${src}-960.webp" srcset="${src}-480.webp 480w, ${src}-960.webp 960w, ${src}-${width}.webp ${width}w" sizes="(max-width: 760px) 100vw, (max-width: 1200px) 60vw, 800px" width="${width}" height="${(width * 2) / 3}" alt="${escaped}" loading="lazy" decoding="async"/>`;
}
