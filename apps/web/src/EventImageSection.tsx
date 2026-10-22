import { IMAGE_TYPES, isImageType, MAX_IMAGE_BYTES, type Event } from "@travel-planner/shared";
import { ImagePlus, Plus } from "lucide-react";
import { useRef, useState, type DragEvent } from "react";
import { EnlargeableImage, useEventImageUrl } from "./eventImage";
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
  pending: PendingImage | undefined;
  // True while the picture is being uploaded by Save.
  uploading: boolean;
  readOnly: boolean;
  onPick: (file: File) => void;
  onRemove: () => void;
};

// Why a file cannot be used, judged by what the browser says it is (the server looks at the bytes).
function problem(file: File): "image.wrongType" | "image.tooLarge" | undefined {
  if (!isImageType(file.type)) return "image.wrongType";
  return file.size > MAX_IMAGE_BYTES ? "image.tooLarge" : undefined;
}

// The Image section of the Event panel (design 26 and 46): the Event's own picture with Replace and
// Remove, or an empty tile with Add image. One picture per Event.
export function EventImageSection({ event, kind, pending, uploading, readOnly, onPick, onRemove }: Props) {
  const t = useT();
  const input = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<"image.wrongType" | "image.tooLarge" | undefined>();
  const savedUrl = useEventImageUrl(event ?? { id: "", imageId: null });
  const removed = pending?.kind === "remove";
  const url = pending?.kind === "set" ? pending.url : removed ? undefined : savedUrl;
  // Saved and still loading: show the place of the picture, not the empty tile.
  const has = pending?.kind === "set" || (!removed && Boolean(event?.imageId));

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

  return (
    <section className="image-section" aria-labelledby="image-section-title" onDragOver={(e) => e.preventDefault()} onDrop={onDrop}>
      <h4 id="image-section-title">{t("image.title")}</h4>
      {has ? (
        <div className="image-block">
          {url ? <EnlargeableImage src={url} alt={event?.title ?? ""} label={t("image.enlarge")} /> : <div className="image-tile" aria-hidden="true" />}
          {url && <span className="image-tag">{t("image.yours")}</span>}
        </div>
      ) : (
        <div className="image-tile" aria-hidden="true">
          <KindIcon kind={kind} transportLabel={null} />
        </div>
      )}
      <div className="image-actions">
        {has ? (
          <>
            <button type="button" className="btn sm" disabled={readOnly || uploading} onClick={() => input.current?.click()}>
              <ImagePlus size={13} aria-hidden="true" />
              {t("image.replace")}
            </button>
            <button type="button" className="btn sm ghost danger" disabled={readOnly || uploading} onClick={onRemove}>
              {t("image.remove")}
            </button>
          </>
        ) : (
          <button type="button" className="btn sm" disabled={readOnly || uploading} onClick={() => input.current?.click()}>
            <Plus size={13} aria-hidden="true" />
            {t("image.add")}
          </button>
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
      ) : removed && event?.imageId ? (
        <p className="hint">{t("image.removedOnSave")}</p>
      ) : (
        <p className="hint">{t("image.hint")}</p>
      )}
    </section>
  );
}
