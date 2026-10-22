import { X } from "lucide-react";
import { createContext, useContext, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { getEventImage } from "./api";
import { useT } from "./preferences";

// The Trip the Events on screen belong to, which an image is read through (a Viewer reads through the
// share link and ignores it).
export const TripIdContext = createContext<string | undefined>(undefined);

// Object URLs of the images read so far, by Event and image id: a new image has a new id, so a
// changed or removed image is never shown from here. A failed read is forgotten, so it is tried again.
const urls = new Map<string, Promise<string>>();

// Frees the pictures read for an Event other than the one with `keep` (all of them without it).
function forget(eventId: string, keep?: string) {
  for (const [key, pending] of urls) {
    if (!key.startsWith(`${eventId}:`) || key === keep) continue;
    urls.delete(key);
    pending.then((url) => URL.revokeObjectURL(url), () => undefined);
  }
}

// The address to show an Event's uploaded image from, or undefined while it loads (or fails) and
// when the Event has none.
export function useEventImageUrl(event: { id: string; imageId: string | null }): string | undefined {
  const tripId = useContext(TripIdContext);
  const [loaded, setLoaded] = useState<{ key: string; url: string } | undefined>();
  const key = event.imageId ? `${event.id}:${event.imageId}` : undefined;

  useEffect(() => {
    if (!tripId) return;
    // The Event's image changed or went: the old pictures are not needed any more.
    forget(event.id, key);
    if (!key) return;
    let cancelled = false;
    let pending = urls.get(key);
    if (!pending) {
      pending = getEventImage(tripId, event.id).then((blob) => URL.createObjectURL(blob));
      urls.set(key, pending);
      pending.catch(() => urls.delete(key));
    }
    pending.then(
      (url) => !cancelled && setLoaded({ key, url }),
      () => undefined,
    );
    return () => {
      cancelled = true;
    };
  }, [key, tripId, event.id]);

  return key && loaded?.key === key ? loaded.url : undefined;
}

type ImageProps = { event: { id: string; imageId: string | null; title: string }; className?: string };

// An Event's uploaded image, or nothing. Decorative where the title is next to it (`alt=""`).
export function EventImage({ event, className, decorative }: ImageProps & { decorative?: boolean }) {
  const url = useEventImageUrl(event);
  if (!url) return null;
  return <img className={className} src={url} alt={decorative ? "" : event.title} draggable={false} />;
}

// A picture shown large, over the page (a dialog): closed by Esc, a click outside the picture or the
// close button, and nothing behind it reacts to keys meanwhile. Focus goes to the close button and
// comes back to where it was.
export function ImageLightbox({ src, alt, onClose }: { src: string; alt: string; onClose: () => void }) {
  const t = useT();
  const close = useRef<HTMLButtonElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    close.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      // The page's own shortcuts and its Esc (which closes the panel) must not see keys meanwhile.
      e.stopImmediatePropagation();
      if (e.key === "Escape") {
        e.preventDefault();
        onCloseRef.current();
      } else if (e.key === "Tab") {
        // The close button is the only thing to reach.
        e.preventDefault();
        close.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      opener?.focus?.();
    };
  }, []);

  return createPortal(
    <div
      className="lightbox"
      role="dialog"
      aria-modal="true"
      aria-label={alt}
      onClick={(e) => {
        // Handled here: the click must not reach what this is rendered inside of.
        e.stopPropagation();
        onClose();
      }}
    >
      <button ref={close} type="button" className="icon-btn lightbox-close" aria-label={t("image.close")} title={t("generic.closeEsc")}>
        <X size={20} aria-hidden="true" />
      </button>
      <img src={src} alt={alt} onClick={(e) => e.stopPropagation()} />
    </div>,
    document.body,
  );
}

// A picture that opens large when clicked, for the Viewer's details and the panel's preview.
export function EnlargeableImage({ src, alt, className, label }: { src: string; alt: string; className?: string; label: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className={`image-open${className ? ` ${className}` : ""}`} aria-label={label} onClick={() => setOpen(true)}>
        <img src={src} alt={alt} draggable={false} />
      </button>
      {open && <ImageLightbox src={src} alt={alt} onClose={() => setOpen(false)} />}
    </>
  );
}
