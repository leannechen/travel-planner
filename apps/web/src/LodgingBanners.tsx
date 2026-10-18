import { formatMinute, lodgingBanner, type Day, type Event } from "@travel-planner/shared";
import { KindIcon } from "./kinds";
import { useT } from "./preferences";

type Placed = { event: Event; checkInPosition: number };

// The stays of a Trip with the position of their check-in Day.
export function staysOf(days: Day[]): Placed[] {
  return days.flatMap((d) =>
    d.events.filter((e) => e.kind === "lodging" && e.nights).map((event) => ({ event, checkInPosition: d.position })),
  );
}

type Props = {
  position: number;
  stays: Placed[];
  selectedEventId?: string;
  onSelectEvent: (eventId: string) => void;
};

// The banners at the top of one Day: a night of each stay that covers it, and the check-out of a
// stay that ends here. On a change-over Day the check-out comes first.
export function LodgingBanners({ position, stays, selectedEventId, onSelectEvent }: Props) {
  const t = useT();
  const shown = stays.flatMap(({ event, checkInPosition }) => {
    const banner = lodgingBanner({ checkInPosition, nights: event.nights! }, position);
    return banner ? [{ event, banner }] : [];
  });
  shown.sort((a, b) => Number(b.banner.type === "check-out") - Number(a.banner.type === "check-out"));

  return (
    <div className="lodging-banners">
      {shown.map(({ event, banner }) => {
        const classes = ["lodging-banner", "kind-lodging", banner.type, event.id === selectedEventId && "selected"]
          .filter(Boolean)
          .join(" ");
        const note =
          banner.type === "check-out"
            ? event.checkOutMinute !== null && t("banner.checkOut", { time: formatMinute(event.checkOutMinute) })
            : [
                t("banner.night", { n: banner.night, of: banner.of }),
                banner.night === 1 && event.checkInMinute !== null && t("banner.in", { time: formatMinute(event.checkInMinute) }),
              ]
                .filter(Boolean)
                .join(" · ");
        return (
          <button key={`${event.id}-${banner.type}`} type="button" className={classes} data-event-id={event.id} onClick={() => onSelectEvent(event.id)}>
            <KindIcon kind="lodging" transportLabel={null} />
            <span className="banner-title">{event.title}</span>
            {note && <span className="banner-note">{note}</span>}
          </button>
        );
      })}
    </div>
  );
}
