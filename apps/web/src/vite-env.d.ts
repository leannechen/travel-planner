/// <reference types="vite/client" />
/// <reference types="google.maps" />

interface ImportMetaEnv {
  // Browser key for the Maps JavaScript API (the Map View); without it a sample map is shown.
  readonly VITE_GOOGLE_MAPS_API_KEY?: string;
  // Optional map id for advanced markers; Google's demo id is used when empty.
  readonly VITE_GOOGLE_MAP_ID?: string;
}
