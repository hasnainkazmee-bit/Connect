import { useCallback, useEffect, useId, useRef, useState } from "react";
import { useApp } from "./context";
import { usePageGuard } from "./page-navigation";
import Cropper, { type Area } from "react-easy-crop";
import { LoaderCircle, RotateCcw, X, ZoomIn, ZoomOut } from "lucide-react";
import "react-easy-crop/react-easy-crop.css";
import "./photo-adjuster.css";

export type PhotoAspect = { label: string; value: number | "original" };
export type PhotoAdjustOptions = {
  title?: string;
  aspects?: readonly PhotoAspect[];
  initialAspect?: number | "original";
};
export const POST_PHOTO_ASPECTS: readonly PhotoAspect[] = [
  { label: "Original", value: "original" },
  { label: "Portrait 4:5", value: 4 / 5 },
  { label: "Square 1:1", value: 1 },
];
const MAX_FILE_SIZE = 10 * 1024 * 1024;

// Preview and canvas share the browser's decoded image, including EXIF orientation.
async function cropFile(image: HTMLImageElement, file: File, area: Area) {
  const x = Math.max(0, Math.min(area.x, image.naturalWidth - 1));
  const y = Math.max(0, Math.min(area.y, image.naturalHeight - 1));
  const width = Math.max(1, Math.min(area.width, image.naturalWidth - x));
  const height = Math.max(1, Math.min(area.height, image.naturalHeight - y));
  const transparent =
    /image\/(png|webp)/.test(file.type) || /\.(png|webp)$/i.test(file.name);
  const mime = transparent ? "image/png" : "image/jpeg";
  const canvas = document.createElement("canvas");
  let size = Math.min(2048, Math.max(width, height));
  for (let attempt = 0; attempt < 5; attempt++) {
    const scale = Math.min(1, size / Math.max(width, height));
    canvas.width = Math.max(1, Math.round(width * scale));
    canvas.height = Math.max(1, Math.round(height * scale));
    const context = canvas.getContext("2d");
    if (!context)
      throw new Error(
        "This browser couldn’t prepare your photo. Please try another browser.",
      );
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = "high";
    context.drawImage(
      image,
      x,
      y,
      width,
      height,
      0,
      0,
      canvas.width,
      canvas.height,
    );
    const blob = await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob(
        (value) =>
          value
            ? resolve(value)
            : reject(
                new Error(
                  "Couldn’t prepare this photo. Try a different image.",
                ),
              ),
        mime,
        0.9,
      ),
    );
    if (blob.size <= MAX_FILE_SIZE) {
      const stem = file.name.replace(/\.[^.]+$/, "") || "photo";
      return new File(
        [blob],
        `${stem}-adjusted.${transparent ? "png" : "jpg"}`,
        { type: mime, lastModified: Date.now() },
      );
    }
    size = Math.floor(size * 0.75);
  }
  throw new Error(
    "This photo is too large to prepare. Please choose a smaller image.",
  );
}

/** Photo adjustment is a separate page; the source editor retains its draft. */
export function usePhotoAdjuster() {
  const { open } = useApp();
  const [adjustingPhoto, setAdjusting] = useState(false);
  const pending = useRef<((file: File | null) => void) | null>(null);
  useEffect(
    () => () => {
      pending.current?.(null);
      pending.current = null;
    },
    [],
  );
  const adjustPhoto = (file: File, options: PhotoAdjustOptions = {}) =>
    new Promise<File | null>((resolve) => {
      pending.current?.(null);
      pending.current = resolve;
      setAdjusting(true);
      const finish = (value: File | null) => {
        if (pending.current !== resolve) return;
        pending.current = null;
        setAdjusting(false);
        resolve(value);
      };
      open(
        <PhotoAdjuster
          file={file}
          options={options}
          onDone={finish}
          onLeave={() => finish(null)}
        />,
      );
    });
  return { adjustPhoto, adjustingPhoto, photoAdjuster: null };
}

function PhotoAdjuster({
  file,
  options,
  onDone,
  onLeave,
}: {
  file: File;
  options: PhotoAdjustOptions;
  onDone: (file: File | null) => void;
  onLeave: () => void;
}) {
  const { close } = useApp();
  const finishPhoto = (value: File | null) => {
    onDone(value);
    close(true);
  };
  const cancel = useRef<HTMLButtonElement>(null),
    id = useId();
  const decoded = useRef<HTMLImageElement | null>(null),
    area = useRef<Area | null>(null);
  const [source, setSource] = useState(""),
    [ratio, setRatio] = useState(1),
    [ready, setReady] = useState(false);
  const [crop, setCrop] = useState({ x: 0, y: 0 }),
    [zoom, setZoom] = useState(1);
  const aspects = options.aspects?.length
    ? options.aspects
    : POST_PHOTO_ASPECTS;
  const initialAspect = options.initialAspect ?? aspects[0].value;
  const [aspect, setAspect] = useState<number | "original">(initialAspect);
  const [resetVersion, setResetVersion] = useState(0);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const mounted = useRef(true),
    busyRef = useRef(false);
  usePageGuard(false, busy);
  const leave = useRef(onLeave);
  useEffect(() => () => leave.current(), []);
  useEffect(() => {
    mounted.current = true;
    let alive = true;
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      if (!alive) return;
      if (
        !image.naturalWidth ||
        !image.naturalHeight ||
        image.naturalWidth * image.naturalHeight > 60000000
      ) {
        setError("Choose a photo smaller than 60 megapixels.");
        return;
      }
      decoded.current = image;
      setRatio(image.naturalWidth / image.naturalHeight);
      setSource(url);
    };
    image.onerror = () => {
      if (alive)
        setError(
          "This image couldn’t be opened. Choose a JPG, PNG, or WebP photo.",
        );
    };
    if (file.size > MAX_FILE_SIZE) setError("Choose a photo under 10 MB.");
    else if (
      !/^(image\/(jpeg|png|webp))$/.test(file.type) &&
      !/\.(jpe?g|png|webp)$/i.test(file.name)
    )
      setError("Choose a JPG, PNG, or WebP photo.");
    else image.src = url;
    return () => {
      alive = false;
      mounted.current = false;
      URL.revokeObjectURL(url);
    };
  }, [file]);
  const reset = (next = initialAspect) => {
    area.current = null;
    setReady(false);
    setAspect(next);
    setCrop({ x: 0, y: 0 });
    setZoom(1);
    setResetVersion((value) => value + 1);
  };
  const usePhoto = async (original = false) => {
    if (busyRef.current || !decoded.current || (!original && !area.current))
      return;
    busyRef.current = true;
    setBusy(true);
    setError("");
    try {
      const image = decoded.current;
      const result = await cropFile(
        image,
        file,
        original
          ? {
              x: 0,
              y: 0,
              width: image.naturalWidth,
              height: image.naturalHeight,
            }
          : area.current!,
      );
      if (mounted.current) finishPhoto(result);
    } catch (e) {
      if (mounted.current) setError((e as Error).message);
    } finally {
      busyRef.current = false;
      if (mounted.current) setBusy(false);
    }
  };
  return (
    <section
      className="photo-adjuster photo-adjuster-page"
      aria-labelledby={id + "-title"}
    >
      <header>
        <div>
          <h2 id={id + "-title"}>{options.title || "Adjust photo"}</h2>
          <p id={id + "-hint"}>Drag to position. Pinch or zoom to crop.</p>
        </div>
        <button
          ref={cancel}
          type="button"
          className="icon-button"
          aria-label="Cancel photo adjustment"
          disabled={busy}
          onClick={() => finishPhoto(null)}
        >
          <X size={20} />
        </button>
      </header>
      {aspects.length > 1 && (
        <div
          className="photo-adjuster-aspects"
          role="group"
          aria-label="Photo shape"
        >
          {aspects.map((option) => (
            <button
              key={option.value}
              type="button"
              disabled={busy}
              aria-pressed={aspect === option.value}
              onClick={() => reset(option.value)}
            >
              {option.label}
            </button>
          ))}
        </div>
      )}
      <div className="photo-adjuster-stage" aria-busy={!source || busy}>
        {source ? (
          <Cropper
            key={resetVersion}
            image={source}
            crop={crop}
            zoom={zoom}
            aspect={aspect === "original" ? ratio : aspect}
            minZoom={1}
            maxZoom={3}
            restrictPosition
            showGrid
            disableAutomaticStylesInjection
            zoomWithScroll={false}
            onCropChange={(value) => {
              if (!busyRef.current) setCrop(value);
            }}
            onZoomChange={(value) => {
              if (!busyRef.current) setZoom(value);
            }}
            keyboardStep={10}
            onCropAreaChange={(_percent, pixels) => {
              area.current = pixels;
              setReady(true);
            }}
            cropperProps={{
              role: "group",
              "aria-label": "Photo position",
              "aria-describedby": id + "-hint",
              tabIndex: busy ? -1 : 0,
            }}
            style={{
              containerStyle: { pointerEvents: busy ? "none" : "auto" },
            }}
            mediaProps={{ alt: "Photo to adjust" }}
          />
        ) : (
          <span>
            {error ? (
              "Photo unavailable"
            ) : (
              <>
                <LoaderCircle className="spin" /> Preparing photo…
              </>
            )}
          </span>
        )}
      </div>
      <div className="photo-adjuster-controls">
        <div className="photo-adjuster-zoom">
          <ZoomOut size={18} aria-hidden="true" />
          <input
            aria-label="Photo zoom"
            type="range"
            min={1}
            max={3}
            step={0.01}
            value={zoom}
            disabled={busy || !source}
            onChange={(event) => setZoom(Number(event.target.value))}
          />
          <ZoomIn size={18} aria-hidden="true" />
          <output>{Math.round(zoom * 100)}%</output>
        </div>
        <div className="photo-adjuster-utilities">
          <button
            type="button"
            disabled={busy || !source}
            onClick={() => reset()}
          >
            <RotateCcw size={15} />
            Reset
          </button>
          {aspects.some((option) => option.value === "original") && (
            <button
              type="button"
              disabled={busy || !source}
              onClick={() => void usePhoto(true)}
            >
              Use original
            </button>
          )}
        </div>
        <span className="sr-only">
          Use arrow keys on Photo position to move the image. Use arrow keys on
          Photo zoom to change magnification.
        </span>
        {error && (
          <p className="photo-adjuster-error" role="alert">
            {error}
          </p>
        )}
      </div>
      <footer>
        <button
          type="button"
          className="button"
          disabled={busy}
          onClick={() => finishPhoto(null)}
        >
          Cancel
        </button>
        <button
          type="button"
          className="button primary"
          disabled={busy || !ready}
          onClick={() => void usePhoto()}
        >
          {busy ? (
            <>
              <LoaderCircle size={17} className="spin" />
              Preparing…
            </>
          ) : (
            "Use photo"
          )}
        </button>
      </footer>
    </section>
  );
}
