export type CityBackgroundGroup = "families" | "grids" | "isometric";

export interface CityBackground {
  readonly id: string;
  readonly label: string;
  readonly group: CityBackgroundGroup;
  readonly layers: ReadonlyArray<string>;
  readonly ground?: string;
}

export const CITY_THEME_ID = "city-783";
export const CITY_BACKGROUND_STORAGE_KEY = "t3code:city-783-background";
export const DEFAULT_CITY_BACKGROUND_ID = "iso-24-clear-centre";

export const CITY_BACKGROUND_GROUPS: ReadonlyArray<{
  readonly id: CityBackgroundGroup;
  readonly label: string;
}> = [
  { id: "families", label: "Families" },
  { id: "grids", label: "Grids" },
  { id: "isometric", label: "Isometric" },
];

export const CITY_BACKGROUNDS: ReadonlyArray<CityBackground> = [
  {
    id: "dots",
    label: "dots",
    group: "families",
    layers: ["bgl-bg-dots bgl-m-bl"],
  },
  {
    id: "hatch",
    label: "hatch",
    group: "families",
    layers: ["bgl-bg-hatch bgl-m-bl"],
  },
  {
    id: "lattice",
    label: "lattice",
    group: "families",
    layers: ["bgl-bg-lattice bgl-m-c"],
  },
  {
    id: "scan-ember",
    label: "scan + ember",
    group: "families",
    layers: ["bgl-bg-ember", "bgl-bg-scan"],
    ground: "#1b1d23",
  },
  {
    id: "tint-grain",
    label: "tint + grain",
    group: "families",
    layers: ["bgl-bg-tint", "bgl-bg-glow", "bgl-bg-rings bgl-m-bl", "bgl-bg-grain"],
  },
  {
    id: "fine-8",
    label: "fine 8",
    group: "grids",
    layers: ["bgl-g-fine"],
  },
  {
    id: "grid-top-left",
    label: "16 / 128 top-left",
    group: "grids",
    layers: ["bgl-g-16 bgl-m-tl"],
  },
  {
    id: "grid-bottom-left",
    label: "16 / 128 bottom-left",
    group: "grids",
    layers: ["bgl-g-16 bgl-m-bl"],
  },
  {
    id: "grid-clear-centre",
    label: "16 / 128 clear centre",
    group: "grids",
    layers: ["bgl-g-16 bgl-m-edge"],
  },
  {
    id: "crosses-24",
    label: "crosses 24",
    group: "grids",
    layers: ["bgl-g-hx bgl-m-tickx", "bgl-g-vx bgl-m-ticky"],
  },
  {
    id: "points-24",
    label: "points 24",
    group: "grids",
    layers: ["bgl-g-pts"],
  },
  {
    id: "dashed-24",
    label: "dashed 24",
    group: "grids",
    layers: ["bgl-g-h24 bgl-m-dashx", "bgl-g-v24 bgl-m-dashy"],
  },
  {
    id: "blueprint",
    label: "blueprint 32 / 160",
    group: "grids",
    layers: ["bgl-g-blue bgl-m-tl"],
  },
  {
    id: "grid-ember",
    label: "grid + ember",
    group: "grids",
    layers: ["bgl-g-ember", "bgl-g-16 bgl-m-tl"],
    ground: "#1b1d23",
  },
  {
    id: "grid-tint",
    label: "grid + tint",
    group: "grids",
    layers: ["bgl-g-tint", "bgl-g-glow", "bgl-g-16 bgl-m-bl"],
  },
  {
    id: "isometric",
    label: "isometric",
    group: "grids",
    layers: ["bgl-g-iso bgl-m-c"],
  },
  {
    id: "graph-paper",
    label: "graph paper",
    group: "grids",
    layers: ["bgl-g-paper bgl-m-bl"],
  },
  {
    id: "ruled-columns",
    label: "ruled + 12 columns",
    group: "grids",
    layers: ["bgl-g-hz", "bgl-g-col bgl-m-bl"],
  },
  {
    id: "iso-24",
    label: "iso 24",
    group: "isometric",
    layers: ["bgl-i-24"],
  },
  {
    id: "iso-24-bottom-left",
    label: "iso 24 bottom-left",
    group: "isometric",
    layers: ["bgl-i-24 bgl-m-bl"],
  },
  {
    id: "iso-24-clear-centre",
    label: "iso 24 clear centre",
    group: "isometric",
    layers: ["bgl-i-24 bgl-m-edge"],
  },
  {
    id: "iso-16",
    label: "iso 16",
    group: "isometric",
    layers: ["bgl-i-16"],
  },
  {
    id: "iso-32-bottom-left",
    label: "iso 32 bottom-left",
    group: "isometric",
    layers: ["bgl-i-32 bgl-m-bl"],
  },
  {
    id: "rhombus",
    label: "rhombus",
    group: "isometric",
    layers: ["bgl-i-rh bgl-m-c"],
  },
  {
    id: "iso-dashed",
    label: "iso dashed",
    group: "isometric",
    layers: ["bgl-i-30 bgl-m-d30", "bgl-i-150 bgl-m-d150", "bgl-i-v bgl-m-dv"],
  },
  {
    id: "iso-points",
    label: "iso points",
    group: "isometric",
    layers: ["bgl-i-pts"],
  },
  {
    id: "iso-major",
    label: "iso + major",
    group: "isometric",
    layers: ["bgl-i-24", "bgl-i-major bgl-m-bl"],
  },
  {
    id: "iso-red",
    label: "iso + red",
    group: "isometric",
    layers: ["bgl-i-24", "bgl-i-red bgl-m-bl"],
  },
  {
    id: "iso-ember",
    label: "iso + ember",
    group: "isometric",
    layers: ["bgl-i-ember", "bgl-i-24 bgl-m-bl"],
    ground: "#1b1d23",
  },
  {
    id: "cubes",
    label: "cubes",
    group: "isometric",
    layers: ["bgl-i-cubes bgl-m-bl"],
  },
];

export function findCityBackground(id: string): CityBackground {
  return (
    CITY_BACKGROUNDS.find((entry) => entry.id === id) ??
    CITY_BACKGROUNDS.find((entry) => entry.id === DEFAULT_CITY_BACKGROUND_ID)!
  );
}
