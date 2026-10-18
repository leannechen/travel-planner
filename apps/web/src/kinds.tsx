import type { Event } from "@travel-planner/shared";
import { BedDouble, Bus, Flag, Plane, Route, Ship, TrainFront, Utensils, type LucideIcon } from "lucide-react";

export const KIND_NAMES: Record<Event["kind"], string> = {
  attraction: "Attraction",
  meal: "Meal",
  lodging: "Lodging",
  transport: "Transport",
};

export const TRANSPORT_LABEL_NAMES: Record<NonNullable<Event["transportLabel"]>, string> = {
  flight: "Flight",
  train: "Train",
  ferry: "Ferry",
  bus: "Bus",
  other: "Other",
};

const KIND_ICONS: Record<Event["kind"], LucideIcon> = {
  attraction: Flag,
  meal: Utensils,
  lodging: BedDouble,
  transport: Route,
};

const TRANSPORT_ICONS: Record<NonNullable<Event["transportLabel"]>, LucideIcon> = {
  flight: Plane,
  train: TrainFront,
  ferry: Ship,
  bus: Bus,
  other: Route,
};

// A Transport event's label sets its icon; without a label it shows the kind's icon.
export function KindIcon({ kind, transportLabel, size = 14 }: Pick<Event, "kind" | "transportLabel"> & { size?: number }) {
  const Icon = kind === "transport" && transportLabel ? TRANSPORT_ICONS[transportLabel] : KIND_ICONS[kind];
  return <Icon size={size} aria-hidden="true" />;
}
