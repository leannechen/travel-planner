import { BACKUP_FORMAT, BACKUP_VERSION } from "./index";
import { orderNotes } from "./notes";
import type { Backup, Event, SeedEventInput, SeedImage, TravelMode, Trip, TripSeedInput } from "./index";

// The backup of a Trip as the owner sees it. `images` has the uploaded image of each Event that has
// one, by Event id. Todos keep their text and done state, Legs only their mode (an import calculates
// them again), and Notes their order. Ids, who made a Todo, and Google photos are not kept.
export function buildBackup(trip: Trip, images: ReadonlyMap<string, SeedImage>): Backup {
  const legModes = new Map<string, TravelMode>(trip.legs.map((leg) => [leg.fromEventId, leg.mode]));
  const todoOf = (todo: { text: string; done: boolean }) => ({ text: todo.text, done: todo.done });
  const seedEvent = (e: Event): SeedEventInput => ({
    title: e.title,
    kind: e.kind,
    transportLabel: e.transportLabel,
    nights: e.nights,
    checkInMinute: e.checkInMinute,
    checkOutMinute: e.checkOutMinute,
    description: e.description,
    phone: e.phone,
    email: e.email,
    website: e.website,
    bookingUrl: e.bookingUrl,
    placeId: e.placeId,
    destinationId: e.destinationId,
    placePhotoHidden: e.placePhotoHidden,
    startMinute: e.startMinute,
    durationMinutes: e.durationMinutes,
    openingHoursOn: e.openingHoursOn,
    todos: trip.todos.filter((todo) => todo.eventId === e.id).map(todoOf),
    legToNext: legModes.get(e.id) ?? null,
    image: images.get(e.id) ?? null,
  });
  const { pinned, recent } = orderNotes(trip.notes);
  const seed: TripSeedInput = {
    title: trip.title,
    travelMode: trip.travelMode,
    startDate: trip.startDate,
    days: [...trip.days].sort((a, b) => a.position - b.position).map((day) => day.events.map(seedEvent)),
    backlog: trip.backlog.map(seedEvent),
    archive: trip.archive.map(seedEvent),
    todos: trip.todos.filter((todo) => todo.eventId === null).map(todoOf),
    notes: [...pinned, ...recent].map((note) => ({ body: note.body, pinned: note.pinned })),
  };
  // Not checked against the import limits: a Trip the app let the user build can always be saved.
  return { format: BACKUP_FORMAT, version: BACKUP_VERSION, trip: seed as Backup["trip"] };
}
