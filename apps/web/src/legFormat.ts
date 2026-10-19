import type { TravelMode } from "@travel-planner/shared";
import { Car, Footprints, TrainFront, type LucideIcon } from "lucide-react";
import type { Params } from "./i18n";
import type { MessageKey } from "./messages";

type Translate = (key: MessageKey, params?: Params) => string;

export const MODE_ICONS: Record<TravelMode, LucideIcon> = { drive: Car, transit: TrainFront, walk: Footprints };
export const modeKey = (mode: TravelMode) => `leg.${mode}` as const;

// "20 min", "1 h" or "1 h 5 min".
export function formatDuration(minutes: number, t: Translate): string {
  if (minutes < 60) return t("leg.minutes", { count: minutes });
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? t("leg.hours", { hours }) : t("leg.hoursMinutes", { hours, minutes: rest });
}

// "650 m" below a kilometre, otherwise kilometres with one decimal ("7.4 km"; whole numbers without).
export function formatDistance(meters: number, t: Translate): string {
  if (meters < 1000) return t("leg.meters", { value: Math.round(meters) });
  const km = Math.round(meters / 100) / 10;
  return t("leg.km", { value: Number.isInteger(km) ? km : km.toFixed(1) });
}
