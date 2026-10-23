import type { MobileThemeId } from "./mobileTheme";

export interface FontFamilies {
  readonly regular: string;
  readonly medium: string;
  readonly bold: string;
}

const DEFAULT_FONT_FAMILIES: FontFamilies = {
  regular: "DMSans-Regular",
  medium: "DMSans-Medium",
  bold: "DMSans-Bold",
};

const CITY_FONT_FAMILIES: FontFamilies = {
  regular: "JetBrainsMono-Regular",
  medium: "JetBrainsMono-Medium",
  bold: "JetBrainsMono-Bold",
};

export function getFontFamilies(themeId: MobileThemeId): FontFamilies {
  return themeId === "city" ? CITY_FONT_FAMILIES : DEFAULT_FONT_FAMILIES;
}

export function fontFamilyVariables(themeId: MobileThemeId): Record<string, string> {
  if (themeId !== "city") return {};
  const families = getFontFamilies(themeId);
  return {
    "--font-sans": families.regular,
    "--font-medium": families.medium,
    "--font-bold": families.bold,
  };
}
