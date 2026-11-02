import { lazy, Suspense } from "react";
import type { ComponentProps } from "react";
export {
  formats,
  RichDocument,
  publicationLabel,
  type PublicationKind,
} from "./publication-content";
const LazyPublisher = lazy(() =>
  import("./publishing").then((m) => ({ default: m.Publisher })),
);
const LazyDrafts = lazy(() =>
  import("./publishing").then((m) => ({ default: m.DraftsDialog })),
);
const loading = (
  <div className="manage-loading" role="status">
    Opening your writing space…
  </div>
);
export function Publisher(props: ComponentProps<typeof LazyPublisher>) {
  return (
    <Suspense fallback={loading}>
      <LazyPublisher {...props} />
    </Suspense>
  );
}
export function DraftsDialog() {
  return (
    <Suspense fallback={loading}>
      <LazyDrafts />
    </Suspense>
  );
}
