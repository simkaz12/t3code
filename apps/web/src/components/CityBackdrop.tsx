import "../city-backgrounds.css";

import { findCityBackground } from "../cityBackgrounds";
import { useCityBackground, useIsCityTheme } from "../hooks/useCityBackground";

export function CityBackdrop() {
  const isCityTheme = useIsCityTheme();
  const [backgroundId] = useCityBackground();
  if (!isCityTheme) return null;

  const background = findCityBackground(backgroundId);

  return (
    <div
      aria-hidden="true"
      className="pointer-events-none fixed inset-0 -z-10 overflow-hidden"
      data-city-background={background.id}
      style={background.ground ? { background: background.ground } : undefined}
    >
      <svg className="absolute size-0" height="0" width="0">
        <filter id="bgl-grain">
          <feTurbulence
            baseFrequency="0.9"
            numOctaves="2"
            stitchTiles="stitch"
            type="fractalNoise"
          />
          <feColorMatrix type="saturate" values="0" />
        </filter>
      </svg>
      {background.layers.map((layer) => (
        <div className="pointer-events-none absolute inset-0" data-layer={layer} key={layer} />
      ))}
    </div>
  );
}
