import * as Schema from "effect/Schema";
import { useSyncExternalStore } from "react";

import {
  CITY_BACKGROUND_STORAGE_KEY,
  CITY_THEME_ID,
  DEFAULT_CITY_BACKGROUND_ID,
  findCityBackground,
} from "../cityBackgrounds";
import { useLocalStorage } from "./useLocalStorage";

function subscribeToThemeId(onChange: () => void) {
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["data-theme-id"],
  });
  return () => observer.disconnect();
}

function isCityThemeActive() {
  return document.documentElement.dataset.themeId === CITY_THEME_ID;
}

export function useIsCityTheme() {
  return useSyncExternalStore(subscribeToThemeId, isCityThemeActive, () => false);
}

export function useCityBackground() {
  const [storedId, setStoredId] = useLocalStorage(
    CITY_BACKGROUND_STORAGE_KEY,
    DEFAULT_CITY_BACKGROUND_ID,
    Schema.String,
  );

  return [findCityBackground(storedId).id, setStoredId] as const;
}
