import type { Place } from "@travel-planner/shared";
import { MapPin, Search, X } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { ApiError, searchPlaces } from "./api";
import { rememberPlaces, usePlace } from "./placeCache";
import { useT } from "./preferences";

const SEARCH_DELAY_MS = 250;

type Props = {
  // What the field is for, for example "Location" or "From".
  label: string;
  // The chosen place's id, or "" for none.
  value: string;
  onChange: (placeId: string) => void;
  optional?: boolean;
};

// Chooses one place by searching: type, pick a result. A chosen place is shown with its name and
// address, and can be removed. Only the place's id is passed on (ADR 0007).
export function PlaceField({ label, value, onChange, optional }: Props) {
  const t = useT();
  const { place, status: lookup } = usePlace(value);
  const removeButton = useRef<HTMLButtonElement>(null);
  // Set when a place was just chosen: the field changes, so focus moves to its Remove button.
  const focusRemove = useRef(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Place[]>([]);
  const [state, setState] = useState<"idle" | "searching" | "error">("idle");
  // Why the last search failed when it was a usage limit (plan step 33): for a minute, or for today.
  const [limit, setLimit] = useState<"minute" | "day" | undefined>();
  const [active, setActive] = useState(0);
  const [open, setOpen] = useState(false);
  const listId = useId();
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (value && focusRemove.current) {
      focusRemove.current = false;
      removeButton.current?.focus();
    }
  }, [value]);

  // Searches shortly after typing stops; a slower earlier answer never replaces a newer one.
  useEffect(() => {
    const text = query.trim();
    if (!text) {
      setResults([]);
      setState("idle");
      return;
    }
    setState("searching");
    let stale = false;
    const timer = setTimeout(() => {
      searchPlaces(text)
        .then((found) => {
          if (stale) return;
          rememberPlaces(found);
          setResults(found);
          setActive(0);
          setState("idle");
        })
        .catch((err: unknown) => {
          if (stale) return;
          // The old results belong to an earlier text; they must not stay next to the error.
          setResults([]);
          setState("error");
          setLimit(err instanceof ApiError && err.code === "search_limit" ? (err.detail.window === "minute" ? "minute" : "day") : undefined);
        });
    }, SEARCH_DELAY_MS);
    return () => {
      stale = true;
      clearTimeout(timer);
    };
  }, [query]);

  function choose(found: Place) {
    rememberPlaces([found]);
    setQuery("");
    setResults([]);
    setOpen(false);
    focusRemove.current = true;
    onChange(found.id);
  }

  function clear() {
    onChange("");
    // Back to the search field, ready to type another place.
    setTimeout(() => input.current?.focus());
  }

  const fieldLabel = optional ? `${label} · ${t("place.optional")}` : label;

  if (value) {
    return (
      <div className="field place-field">
        <span>{fieldLabel}</span>
        <div className="place-chosen">
          <MapPin size={16} aria-hidden="true" />
          <span className="place-text">
            {place ? <strong>{place.name}</strong> : lookup === "loading" ? <strong>…</strong> : <small>{t("place.unavailable")}</small>}
            {place?.address && <small>{place.address}</small>}
          </span>
          <button ref={removeButton} type="button" className="ib" aria-label={t("place.remove", { label })} title={t("place.remove", { label })} onClick={clear}>
            <X size={14} aria-hidden="true" />
          </button>
        </div>
      </div>
    );
  }

  const showList = open && query.trim() !== "";
  return (
    <div className="field place-field">
      <label>
        {fieldLabel}
        <span className="place-input">
          <Search size={16} aria-hidden="true" />
          <input
            ref={input}
            role="combobox"
            aria-expanded={showList}
            aria-controls={listId}
            aria-autocomplete="list"
            aria-activedescendant={showList && results[active] ? `${listId}-${active}` : undefined}
            placeholder={t("place.search")}
            maxLength={200}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setOpen(true);
            }}
            onFocus={() => setOpen(true)}
            onBlur={() => setOpen(false)}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown" && results.length > 0) {
                e.preventDefault();
                setActive((active + 1) % results.length);
              } else if (e.key === "ArrowUp" && results.length > 0) {
                e.preventDefault();
                setActive((active - 1 + results.length) % results.length);
              } else if (e.key === "Enter") {
                // Enter picks the highlighted result; it must not also submit the panel's form.
                e.preventDefault();
                if (showList && results[active]) choose(results[active]);
              } else if (e.key === "Escape" && showList) {
                // Closes the results only, not the whole panel.
                e.stopPropagation();
                setOpen(false);
              }
            }}
          />
        </span>
      </label>
      {showList && (
        <div className="place-popup">
        <ul id={listId} role="listbox" aria-label={label} className="place-results">
          {results.map((found, index) => (
            <li
              key={found.id}
              id={`${listId}-${index}`}
              role="option"
              aria-selected={index === active}
              className={index === active ? "active" : undefined}
              // Before the input's blur, so the click is not lost when the list closes.
              onMouseDown={(e) => {
                e.preventDefault();
                choose(found);
              }}
            >
              <strong>{found.name}</strong>
              <small>{found.address}</small>
            </li>
          ))}
        </ul>
        {state === "searching" && results.length === 0 && <p className="place-note" role="status">{t("place.searching")}</p>}
        {state === "error" && <p className="place-note" role="alert">{t(limit === "minute" ? "place.limitMinute" : limit === "day" ? "place.limitDay" : "place.error")}</p>}
        {state === "idle" && results.length === 0 && <p className="place-note" role="status">{t("place.none")}</p>}
        </div>
      )}
    </div>
  );
}
