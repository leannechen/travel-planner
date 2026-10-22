import { IMAGE_TYPES, isImageType, MAX_IMAGE_BYTES, type Event } from "@travel-planner/shared";
import { ImagePlus, Plus } from "lucide-react";
import { useRef, useState, type DragEvent } from "react";
import { EnlargeableImage, PhotoCredit, useEventImageUrl, usePlacePhoto } from "./eventImage";
import { KindIcon } from "./kinds";
import { useT } from "./preferences";

// What the user chose in the panel and has not saved yet: a picture to upload, or taking the
// Event's image off. Nothing happens to the Event until Save.
export type PendingImage = { kind: "set"; file: File; url: string } | { kind: "remove" };

type Props = {
  // The saved Event, whose image is shown while nothing is pending; absent for a new Event.
  event?: Event;
  // The kind being edited, for the icon on the empty tile.
  kind: Event["kind"];
  // The place chosen in the panel ("" for none), and whether the place's photo was taken off. Both are
  // fields of the panel, saved with it.
  placeId: string;
  placePhotoHidden: boolean;
  pending: PendingImage | undefined;
  // True while the picture is being uploaded by Save.
  uploading: boolean;
  readOnly: boolean;
  onPick: (file: File) => void;
  onRemove: () => void;
  onUsePlacePhoto: () => void;
};

// Why a file cannot be used, judged by what the browser says it is (the server looks at the bytes).
function problem(file: File): "image.wrongType" | "image.tooLarge" | undefined {
  if (!isImageType(file.type)) return "image.wrongType";
  return file.size > MAX_IMAGE_BYTES ? "image.tooLarge" : undefined;
}

// The Image section of the Event panel (design 26 and 46): the Event's own picture, or the place's
// Google photo while there is none, with Replace and Remove; or an empty tile with Add image (and Use
// place photo after Remove). One picture per Event.
export function EventImageSection({ event, kind, placeId, placePhotoHidden, pending, uploading, readOnly, onPick, onRemove, onUsePlacePhoto }: Props) {
  const t = useT();
  const input = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<"image.wrongType" | "image.tooLarge" | undefined>();
  const savedUrl = useEventImageUrl(event ?? { id: "", imageId: null });
  const removed = pending?.kind === "remove";
  const url = pending?.kind === "set" ? pending.url : removed ? undefined : savedUrl;
  // Saved and still loading: show the place of the picture, not the empty tile.
  const hasUpload = pending?.kind === "set" || (!removed && Boolean(event?.imageId));
  // The place photo is read for the Event's saved place, so it is shown while the place is still that one.
  const { photo: place, loading: placeLoading } = usePlacePhoto(event?.id, event?.placeId, !hasUpload && !placePhotoHidden && Boolean(placeId) && event?.placeId === placeId);
  const has = hasUpload || Boolean(place);
  const shownUrl = hasUpload ? url : place?.photoUri;

  function choose(file: File | undefined) {
    if (!file) return;
    const bad = problem(file);
    setError(bad);
    if (!bad) onPick(file);
  }

  function onDrop(e: DragEvent) {
    e.preventDefault();
    if (!readOnly) choose(e.dataTransfer.files[0]);
  }

  // While the place photo is still being asked for, nothing is offered: it may turn out to be there.
  const busy = readOnly || uploading || placeLoading;
  return (
    <section className="image-section" aria-labelledby="image-section-title" onDragOver={(e) => e.preventDefault()} onDrop={onDrop}>
      <h4 id="image-section-title">{t("image.title")}</h4>
      {has ? (
        <div className="image-block">
          {shownUrl ? (
            <EnlargeableImage src={shownUrl} alt={event?.title ?? ""} label={t("image.enlarge")} credit={!hasUpload && place ? <PhotoCredit photo={place} /> : undefined} />
          ) : (
            <div className="image-tile" aria-hidden="true" />
          )}
          {shownUrl && <span className="image-tag">{hasUpload ? t("image.yours") : t("image.placeTag")}</span>}
        </div>
      ) : (
        <div className={`image-tile kind-${kind}`} aria-hidden="true">
          <KindIcon kind={kind} transportLabel={null} />
        </div>
      )}
      {!hasUpload && place && (
        <p className="hint">
          <PhotoCredit photo={place} />
        </p>
      )}
      <div className="image-actions">
        {has ? (
          <>
            <button type="button" className="btn sm" disabled={busy} onClick={() => input.current?.click()}>
              <ImagePlus size={13} aria-hidden="true" />
              {t("image.replace")}
            </button>
            <button type="button" className="btn sm ghost danger" disabled={busy} onClick={onRemove}>
              {t("image.remove")}
            </button>
          </>
        ) : (
          <>
            {placePhotoHidden && placeId && (
              <button type="button" className="btn sm" disabled={busy} onClick={onUsePlacePhoto}>
                {t("image.usePlace")}
              </button>
            )}
            <button type="button" className="btn sm" disabled={busy} onClick={() => input.current?.click()}>
              <Plus size={13} aria-hidden="true" />
              {t("image.add")}
            </button>
          </>
        )}
      </div>
      <input
        ref={input}
        type="file"
        hidden
        accept={IMAGE_TYPES.join(",")}
        data-testid="image-input"
        onChange={(e) => {
          choose(e.target.files?.[0]);
          // The same file can be chosen again after Remove.
          e.target.value = "";
        }}
      />
      {uploading ? (
        <p className="hint" role="status">
          {t("image.uploading")}
        </p>
      ) : error ? (
        <p className="hint error" role="alert">
          {t(error)}
        </p>
      ) : !has && placePhotoHidden && placeId ? (
        <p className="hint">{t("image.hintHidden")}</p>
      ) : removed && event?.imageId ? (
        <p className="hint">{t("image.removedOnSave")}</p>
      ) : !hasUpload && place ? (
        <p className="hint">{t("image.hintPlace")}</p>
      ) : !has && !placePhotoHidden && placeId && event?.placeId !== placeId ? (
        // A place chosen but not saved: its photo is read for the saved Event, so it shows after Save.
        <p className="hint">{t("image.hintAfterSave")}</p>
      ) : (
        <p className="hint">{t("image.hint")}</p>
      )}
    </section>
  );
}
