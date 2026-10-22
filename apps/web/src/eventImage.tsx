import type { Event, PlacePhoto } from "@travel-planner/shared";
import { X } from "lucide-react";
import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { getEventImage, getPlacePhoto } from "./api";
import { KindIcon } from "./kinds";
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

// The place photos asked for, by Event and place. The picture's address is short-lived, so an entry
// is used for a few minutes only; "none" (null) is kept as well, so a place without a photo is not
// asked again for every card. A failed request is forgotten, so it is tried again.
const PHOTO_TTL_MS = 10 * 60 * 1000;
const photos = new Map<string, { at: number; pending: Promise<PlacePhoto | null> }>();

function readPlacePhoto(tripId: string, eventId: string, placeId: string): Promise<PlacePhoto | null> {
  const key = `${eventId}:${placeId}`;
  const known = photos.get(key);
  if (known && Date.now() - known.at < PHOTO_TTL_MS) return known.pending;
  const pending = Promise.resolve().then(() => getPlacePhoto(tripId, eventId));
  photos.set(key, { at: Date.now(), pending });
  pending.catch(() => photos.delete(key));
  return pending;
}

// The Google photo of the Event's place while `enabled` (the Event has no upload and the photo was not
// taken off), or undefined while it loads, when the place has none, and on failure. The Event's saved
// place is asked about, so `placeId` must be it.
// `loading` is true until the answer is in, so a panel does not offer "Add image" for a photo that is
// about to appear.
export function usePlacePhoto(
  eventId: string | undefined,
  placeId: string | null | undefined,
  enabled: boolean,
): { photo: PlacePhoto | undefined; loading: boolean } {
  const tripId = useContext(TripIdContext);
  const [answer, setAnswer] = useState<{ key: string; photo: PlacePhoto | null } | undefined>();
  const key = eventId && placeId ? `${eventId}:${placeId}` : undefined;

  useEffect(() => {
    if (!tripId || !eventId || !placeId || !enabled) return;
    let cancelled = false;
    const done = (photo: PlacePhoto | null) => !cancelled && setAnswer({ key: `${eventId}:${placeId}`, photo });
    readPlacePhoto(tripId, eventId, placeId).then(done, () => done(null));
    return () => {
      cancelled = true;
    };
  }, [tripId, eventId, placeId, enabled]);

  const current = enabled && key && answer?.key === key ? answer : undefined;
  return { photo: current?.photo ?? undefined, loading: Boolean(enabled && key && tripId && !current) };
}

export type PictureEvent = Pick<Event, "id" | "imageId" | "placeId" | "placePhotoHidden">;
// What an Event shows as its picture, and where the place photo came from (to credit it).
export type Picture = { src: string; place?: PlacePhoto };

// The Event's picture by the priority of PRD §3.2: its own upload, else the place's Google photo
// unless that was taken off, else nothing (the kind's icon is shown instead).
export function useEventPicture(event: PictureEvent): Picture | undefined {
  const upload = useEventImageUrl(event);
  const { photo: place } = usePlacePhoto(event.id, event.placeId, !event.imageId && !event.placePhotoHidden);
  if (event.imageId) return upload ? { src: upload } : undefined;
  return place ? { src: place.photoUri, place } : undefined;
}

// The picture on a tall Event card, or the kind's icon on a tile of the same size while there is none
// (design 26). Decorative: the title is next to it.
export function EventThumb({ event }: { event: PictureEvent & Pick<Event, "kind" | "transportLabel"> }) {
  const picture = useEventPicture(event);
  if (picture) return <img className="event-thumb" src={picture.src} alt="" draggable={false} />;
  return (
    <span className="event-thumb event-thumb-tile" aria-hidden="true">
      <KindIcon kind={event.kind} transportLabel={event.transportLabel} size={24} />
    </span>
  );
}

// Who took a place photo and where it can be seen on Google Maps, as Google's terms ask (PRD §3.2).
export function PhotoCredit({ photo }: { photo: PlacePhoto }) {
  const t = useT();
  const link = (href: string, text: string) => (
    <a href={href} target="_blank" rel="noopener noreferrer">
      {text}
    </a>
  );
  return (
    <span className="photo-credit">
      {photo.authors.length > 0 && (
        <>
          {t("image.photoBy")}{" "}
          {photo.authors.map((a, i) => (
            <span key={`${a.name}-${i}`}>
              {i > 0 && ", "}
              {a.uri ? link(a.uri, a.name) : a.name}
            </span>
          ))}
        </>
      )}
      {photo.authors.length > 0 && photo.mapsUri && " · "}
      {photo.mapsUri && link(photo.mapsUri, t("image.viewOnMaps"))}
    </span>
  );
}

// A picture shown large, over the page (a dialog): closed by Esc, a click outside the picture or the
// close button, and nothing behind it reacts to keys meanwhile. Focus goes to the close button and
// comes back to where it was.
export function ImageLightbox({ src, alt, credit, onClose }: { src: string; alt: string; credit?: ReactNode; onClose: () => void }) {
  const t = useT();
  const dialog = useRef<HTMLDivElement>(null);
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
        // Focus stays inside: the close button and the links of the credit, if any.
        e.preventDefault();
        const reachable = [...(dialog.current?.querySelectorAll<HTMLElement>("button, a[href]") ?? [])];
        const at = reachable.indexOf(document.activeElement as HTMLElement);
        reachable[(at + (e.shiftKey ? -1 : 1) + reachable.length) % reachable.length]?.focus();
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
      ref={dialog}
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
      {credit && (
        <div className="lightbox-credit" onClick={(e) => e.stopPropagation()}>
          {credit}
        </div>
      )}
    </div>,
    document.body,
  );
}

// A picture that opens large when clicked, for the Viewer's details and the panel's preview.
export function EnlargeableImage({ src, alt, className, label, credit }: { src: string; alt: string; className?: string; label: string; credit?: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className={`image-open${className ? ` ${className}` : ""}`} aria-label={label} onClick={() => setOpen(true)}>
        <img src={src} alt={alt} draggable={false} />
      </button>
      {open && <ImageLightbox src={src} alt={alt} credit={credit} onClose={() => setOpen(false)} />}
    </>
  );
}
