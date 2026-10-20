import { EVENT_KINDS, type EventFields } from "@travel-planner/shared";
import { Check, ChevronDown } from "lucide-react";
import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { kindKey, KindIcon } from "./kinds";
import { useT } from "./preferences";

type Kind = EventFields["kind"];

// The kind picker at the top of the Event panel. The trigger takes the kind's tint and icon.
export function KindDropdown({ value, onChange, large }: { value: Kind; onChange: (kind: Kind) => void; large?: boolean }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointer = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", onPointer);
    return () => document.removeEventListener("pointerdown", onPointer);
  }, [open]);

  function openMenu() {
    setActive(EVENT_KINDS.indexOf(value));
    setOpen(true);
  }

  function pick(kind: Kind) {
    setOpen(false);
    trigger.current?.focus();
    if (kind !== value) onChange(kind);
  }

  function onKeyDown(e: KeyboardEvent) {
    if (e.key === "Escape" && open) {
      // Closes the list only, not the panel.
      e.stopPropagation();
      setOpen(false);
      return;
    }
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      if (!open) return openMenu();
      const step = e.key === "ArrowDown" ? 1 : -1;
      setActive((a) => (a + step + EVENT_KINDS.length) % EVENT_KINDS.length);
    } else if ((e.key === "Enter" || e.key === " ") && open) {
      e.preventDefault();
      pick(EVENT_KINDS[active]!);
    } else if (open && e.key.length === 1) {
      // The first letter jumps to a kind.
      const at = EVENT_KINDS.findIndex((k) => t(kindKey(k)).toLowerCase().startsWith(e.key.toLowerCase()));
      if (at >= 0) setActive(at);
    }
  }

  return (
    <div className="kind-dd" ref={root} onKeyDown={onKeyDown}>
      <button
        ref={trigger}
        type="button"
        className={`kdd kind-${value}${large ? " lgx" : ""}`}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={`${t("event.kind")}: ${t(kindKey(value))}`}
        onClick={() => (open ? setOpen(false) : openMenu())}
      >
        <span className="kt">
          <KindIcon kind={value} transportLabel={null} size={large ? 17 : 15} />
        </span>
        {t(kindKey(value))}
        <ChevronDown className="ch" size={18} aria-hidden="true" />
      </button>
      {open && (
        <div className="kdm" role="listbox" aria-label={t("event.kind")}>
          {EVENT_KINDS.map((kind, i) => (
            <button
              key={kind}
              type="button"
              role="option"
              aria-selected={kind === value}
              className={`kdi kind-${kind}${kind === value ? " sel" : ""}${i === active ? " hov" : ""}`}
              onClick={() => pick(kind)}
            >
              <span className="kt">
                <KindIcon kind={kind} transportLabel={null} size={16} />
              </span>
              <span>
                <b>{t(kindKey(kind))}</b>
                <em>{t(`${kindKey(kind)}Hint` as "kind.attractionHint")}</em>
              </span>
              {kind === value && <Check className="ck" size={16} aria-hidden="true" />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
