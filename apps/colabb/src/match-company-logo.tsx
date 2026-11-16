import { useState } from "react";

type LogoSurface = { dark: boolean; aspect: number };
const surfaces = new Map<string, LogoSurface>();
const cacheLimit = 200;

function remember(src: string, surface: LogoSurface) {
  surfaces.delete(src);
  surfaces.set(src, surface);
  if (surfaces.size > cacheLimit)
    surfaces.delete(surfaces.keys().next().value!);
}

/** White artwork needs contrast; an opaque white image background does not. */
export function needsDarkLogoBackground(pixels: ArrayLike<number>): boolean {
  const count = Math.floor(pixels.length / 4);
  if (!count) return false;
  let transparent = 0;
  let visibleWeight = 0;
  let whiteWeight = 0;
  let darkWeight = 0;
  for (let i = 0; i + 3 < pixels.length; i += 4) {
    const alpha = pixels[i + 3] / 255;
    if (alpha < 0.1) transparent += 1;
    // Almost invisible antialiased edges should not determine the background.
    if (alpha < 0.2) continue;
    const red = pixels[i];
    const green = pixels[i + 1];
    const blue = pixels[i + 2];
    visibleWeight += alpha;
    if (
      Math.min(red, green, blue) > 190 &&
      Math.max(red, green, blue) - Math.min(red, green, blue) < 65
    )
      whiteWeight += alpha;
    if (0.2126 * red + 0.7152 * green + 0.0722 * blue < 115)
      darkWeight += alpha;
  }
  return (
    transparent / count >= 0.1 &&
    visibleWeight >= 8 &&
    whiteWeight / visibleWeight >= 0.3 &&
    darkWeight / visibleWeight < 0.08
  );
}

function inspectLogo(image: HTMLImageElement): LogoSurface {
  const aspect = image.naturalWidth / image.naturalHeight || 1;
  const surface = { dark: false, aspect };
  if (!image.naturalWidth || !image.naturalHeight) return surface;
  try {
    const scale = Math.min(
      1,
      96 / Math.max(image.naturalWidth, image.naturalHeight),
    );
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) return surface;
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    surface.dark = needsDarkLogoBackground(
      context.getImageData(0, 0, canvas.width, canvas.height).data,
    );
  } catch {
    // External images without CORS remain visible on the normal white tile.
  }
  return surface;
}

export function MatchCompanyLogo({ src, name }: { src: string; name: string }) {
  const [loaded, setLoaded] = useState<{ src: string; surface: LogoSurface }>();
  const [failedSrc, setFailedSrc] = useState("");
  const surface = loaded?.src === src ? loaded.surface : surfaces.get(src);
  const failed = src === failedSrc;
  const dark = !!src && !failed && surface?.dark === true;
  return (
    <span
      className={`match-card-logo${dark ? " match-card-logo-dark" : ""}`}
      data-logo-surface={dark ? "dark" : "light"}
      data-logo-aspect={surface?.aspect}
      style={{ backgroundColor: dark ? "#203746" : "#fff" }}
      aria-hidden={!src || failed ? true : undefined}
    >
      {src && !failed ? (
        <img
          src={src}
          alt={`${name} logo`}
          loading="lazy"
          decoding="async"
          style={{ objectFit: "contain", width: "100%", height: "100%" }}
          onLoad={(event) => {
            const result =
              surfaces.get(src) || inspectLogo(event.currentTarget);
            remember(src, result);
            setLoaded({ src, surface: result });
          }}
          onError={() => setFailedSrc(src)}
        />
      ) : null}
    </span>
  );
}
