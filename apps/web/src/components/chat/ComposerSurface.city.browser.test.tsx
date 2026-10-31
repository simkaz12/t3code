import "~/index.css";

import type { ReactNode } from "react";
import { describe, expect, it } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser";

import { getThemeColorVariable, type ThemeColors } from "~/themePalette";
import { render } from "../../../test/render";
import { Button } from "../ui/button";

import { ComposerBanner } from "./ComposerBanner";
import { ComposerBannerStack, type ComposerBannerStackItem } from "./ComposerBannerStack";
import { ComposerSurface } from "./ComposerSurface";

const CITY_COLORS: Partial<ThemeColors> = {
  canvas: "#181a1f",
  chrome: "#181a1f",
  toolbar: "#181a1f",
  toolbarForeground: "#b9bec6",
  toolbarBorder: "#444446",
  toolbarControl: "#20232a",
  toolbarControlForeground: "#b9bec6",
  toolbarControlHover: "#2c2f36",
  surface: "#181a1f",
  surfaceRaised: "#20232a",
  surfaceOverlay: "#20232a",
  text: "#b9bec6",
  textMuted: "#8f949c",
  border: "#444446",
  input: "#585c62",
  focus: "#ff5c5c",
  accent: "#ad2222",
  accentForeground: "#eceff2",
  muted: "#1e2126",
  mutedForeground: "#8f949c",
  error: "#e53939",
  warning: "#eceff2",
};

const CITY_EDGE_REST = "88 92 98";
const CITY_EDGE_FOCUS = "173 34 34";

function channels(color: string) {
  const srgb = /^color\(srgb ([\d.]+) ([\d.]+) ([\d.]+)\)$/.exec(color);
  if (srgb)
    return srgb
      .slice(1, 4)
      .map((value) => Math.round(Number(value) * 255))
      .join(" ");
  const rgb = /^rgba?\((\d+), (\d+), (\d+)(?:, [\d.]+)?\)$/.exec(color);
  return rgb ? rgb.slice(1, 4).join(" ") : color;
}

type ThemeName = "city-dark" | "city-light" | "default-dark";

function applyTheme(theme: ThemeName) {
  const root = document.documentElement;
  root.classList.toggle("dark", theme !== "city-light");
  if (theme === "default-dark") {
    delete root.dataset.themeId;
    return;
  }
  root.dataset.themeId = "city-783";
  for (const [role, value] of Object.entries(CITY_COLORS)) {
    root.style.setProperty(getThemeColorVariable(role as keyof ThemeColors), value);
  }
}

function resetTheme() {
  const root = document.documentElement;
  delete root.dataset.themeId;
  root.classList.remove("dark");
  root.removeAttribute("style");
}

const SUBAGENTS: ComposerBannerStackItem = {
  id: "subagents",
  variant: "default",
  icon: <span className="size-1.5 rounded-full bg-current" />,
  title: "Waiting on 2 subagents",
  description: "Map pi-jira MCP server, Map verify-ticket and last oktra QA",
  actions: (
    <Button size="xs" variant="ghost">
      Stop
    </Button>
  ),
};

const GOAL: ComposerBannerStackItem = {
  id: "goal",
  variant: "default",
  icon: null,
  title: "Goal active",
  description: "Finish the banner fix",
};

const QUEUED = (
  <ComposerBanner.Attachment>
    <ComposerBanner.Root>
      <ComposerBanner.Row>
        <ComposerBanner.Icon />
        <ComposerBanner.Content>Queued 2 messages</ComposerBanner.Content>
      </ComposerBanner.Row>
    </ComposerBanner.Root>
  </ComposerBanner.Attachment>
);

const APPROVAL = (
  <ComposerBanner.Attachment>
    <ComposerBanner.Root data-chat-composer-top-drawer="true" variant="warning" density="spacious">
      <ComposerBanner.Row layout="approval">
        <ComposerBanner.Icon />
        <ComposerBanner.Content>Run `pnpm test` in the workspace?</ComposerBanner.Content>
        <ComposerBanner.Actions>
          <Button size="xs" variant="ghost">
            Approve
          </Button>
        </ComposerBanner.Actions>
      </ComposerBanner.Row>
    </ComposerBanner.Root>
  </ComposerBanner.Attachment>
);

interface Scenario {
  readonly name: string;
  readonly banners: ReactNode;
  readonly strip: boolean;
  readonly attached: boolean;
  readonly mainClassName?: string;
}

const BANNER_STACK_SINGLE = <ComposerBannerStack items={[SUBAGENTS]} />;
const BANNER_STACK_PEEK = <ComposerBannerStack items={[SUBAGENTS, GOAL]} />;
const QUEUED_AND_BANNER = (
  <>
    {QUEUED}
    <ComposerBannerStack items={[SUBAGENTS]} />
  </>
);

const SCENARIOS = {
  plain: { name: "plain", banners: null, strip: false, attached: false },
  plainStrip: { name: "plain-strip", banners: null, strip: true, attached: false },
  banner: { name: "banner", banners: BANNER_STACK_SINGLE, strip: false, attached: true },
  bannerStrip: { name: "banner-strip", banners: BANNER_STACK_SINGLE, strip: true, attached: true },
  stackStrip: { name: "stack-strip", banners: BANNER_STACK_PEEK, strip: true, attached: true },
  queuedBanner: {
    name: "queued-banner",
    banners: QUEUED_AND_BANNER,
    strip: false,
    attached: true,
  },
  approvalStrip: { name: "approval-strip", banners: APPROVAL, strip: true, attached: true },
  ultrathink: {
    name: "ultrathink",
    banners: null,
    strip: true,
    attached: false,
    mainClassName: "ultrathink-frame",
  },
  ultrathinkBanner: {
    name: "ultrathink-banner",
    banners: BANNER_STACK_SINGLE,
    strip: true,
    attached: true,
    mainClassName: "ultrathink-frame",
  },
} satisfies Record<string, Scenario>;

function composerUi(scenario: Scenario) {
  return (
    <ComposerSurface.Shell contextRow={scenario.strip}>
      <ComposerSurface.Host>
        <div className="relative z-10">
          <form data-chat-composer-form="true" className="mx-auto w-full min-w-0">
            {scenario.banners ? (
              <ComposerBanner.Dock>
                <ComposerBanner.Column>{scenario.banners}</ComposerBanner.Column>
              </ComposerBanner.Dock>
            ) : null}
            <div className="relative">
              <ComposerSurface.Main className={scenario.mainClassName}>
                <div data-chat-composer-surface="true" className="rounded-3xl">
                  <div className="relative px-3 pt-3.5 pb-2 sm:px-4 sm:pt-4">
                    <textarea
                      rows={2}
                      placeholder="Ask anything, @tag files/folders, or / for commands"
                      className="block w-full resize-none bg-transparent text-sm outline-none"
                    />
                    <div className="mt-2 flex items-center gap-3 text-xs text-muted-foreground">
                      <span>Claude Opus 5.5</span>
                      <span>High</span>
                      <span>Full access</span>
                    </div>
                  </div>
                </div>
              </ComposerSurface.Main>
            </div>
          </form>
        </div>
      </ComposerSurface.Host>
      {scenario.strip ? (
        <div className="min-h-0">
          <div className="relative z-0">
            <ComposerSurface.ContextStrip>
              <span className="text-xs text-muted-foreground">Current checkout</span>
              <span className="ms-auto text-xs text-muted-foreground">dev</span>
            </ComposerSurface.ContextStrip>
          </div>
        </div>
      ) : null}
    </ComposerSurface.Shell>
  );
}

async function mount(theme: ThemeName, scenario: Scenario, focused: boolean, phone = false) {
  await page.viewport(phone ? 400 : 900, 640);

  await using stack = new AsyncDisposableStack();
  stack.defer(resetTheme);
  applyTheme(theme);

  const wrapper = document.createElement("div");
  wrapper.style.cssText = `width: ${phone ? 336 : 720}px; padding: 32px; background: var(--background);`;
  stack.use(await render(composerUi(scenario), { container: wrapper }));

  const textarea = wrapper.querySelector("textarea")!;
  if (focused) {
    await userEvent.click(textarea);
    expect(document.activeElement).toBe(textarea);
  }

  const owned = stack.move();
  return {
    wrapper,
    shell: wrapper.querySelector<HTMLElement>('[data-slot="composer-shell"]')!,
    host: wrapper.querySelector<HTMLElement>('[data-slot="composer-host"]')!,
    main: wrapper.querySelector<HTMLElement>('[data-chat-composer-main-surface="true"]')!,
    strip: wrapper.querySelector<HTMLElement>('[data-slot="composer-context-strip"]'),
    banner: wrapper.querySelector<HTMLElement>('[data-composer-banner-surface="attached"]'),
    async [Symbol.asyncDispose]() {
      await owned.disposeAsync();
    },
  };
}

async function shoot(element: HTMLElement, theme: ThemeName, scenario: Scenario, focused: boolean) {
  await page.screenshot({
    element,
    path: `./__screenshots__/ComposerSurface.city/${theme}/${scenario.name}-${focused ? "focus" : "rest"}.png`,
    save: true,
  });
}

const after = (element: Element) => getComputedStyle(element, "::after");
const before = (element: Element) => getComputedStyle(element, "::before");

function visibleEdge(element: Element) {
  const style = after(element);
  return {
    display: style.display,
    color: channels(style.backgroundColor),
    image: style.backgroundImage,
    clipPath: style.clipPath,
  };
}

const FOCUS_STATES = [false, true];

const SCREENSHOT_CASES = [
  ...Object.values(SCENARIOS).flatMap((scenario) =>
    FOCUS_STATES.map((focused) => ({ theme: "city-dark" as const, scenario, focused })),
  ),
  ...[SCENARIOS.plain, SCENARIOS.bannerStrip, SCENARIOS.approvalStrip].flatMap((scenario) =>
    FOCUS_STATES.map((focused) => ({ theme: "city-light" as const, scenario, focused })),
  ),
  ...[SCENARIOS.plainStrip, SCENARIOS.bannerStrip].map((scenario) => ({
    theme: "default-dark" as const,
    scenario,
    focused: false,
  })),
];

describe("composer screenshots", () => {
  it.each(SCREENSHOT_CASES)(
    "$theme $scenario.name focused=$focused",
    async ({ theme, scenario, focused }) => {
      await using scene = await mount(theme, scenario, focused);
      await shoot(scene.wrapper, theme, scenario, focused);
    },
  );
});

describe("City composer below the sm breakpoint", () => {
  it.each([SCENARIOS.bannerStrip, SCENARIOS.plainStrip])(
    "keeps the edge hand-off below the sm breakpoint ($name)",
    async (scenario) => {
      await using scene = await mount("city-dark", scenario, true, true);
      const { host, main } = scene;
      await shoot(
        scene.wrapper,
        "city-dark",
        { ...scenario, name: `${scenario.name}-phone` },
        true,
      );

      const carrier = scenario.attached ? main : host;
      expect(visibleEdge(carrier)).toMatchObject({ display: "block", color: CITY_EDGE_FOCUS });
      expect(after(scenario.attached ? host : main).display).toBe("none");
    },
  );
});

describe("City composer edge", () => {
  it.each(Object.values(SCENARIOS).filter((scenario) => scenario.attached))(
    "hands the ring from the Host to Main while a banner is attached ($name)",
    async (scenario) => {
      await using scene = await mount("city-dark", scenario, false);
      const { host, main } = scene;

      expect(after(host).display).toBe("none");
      expect(getComputedStyle(host).backgroundColor).toBe("rgba(0, 0, 0, 0)");

      const edge = visibleEdge(main);
      expect(edge.display).toBe("block");
      expect(edge.color).toBe(CITY_EDGE_REST);
      expect(edge.clipPath).toContain("polygon");
      expect(getComputedStyle(main).clipPath).toContain("polygon");
    },
  );

  it.each([SCENARIOS.plain, SCENARIOS.plainStrip])(
    "keeps the ring on the Host without a banner ($name)",
    async (scenario) => {
      await using scene = await mount("city-dark", scenario, false);
      const { host, main } = scene;

      expect(visibleEdge(host)).toMatchObject({ display: "block", color: CITY_EDGE_REST });
      expect(after(main).display).toBe("none");
    },
  );

  it.each([SCENARIOS.plain, SCENARIOS.bannerStrip, SCENARIOS.queuedBanner])(
    "turns the carrying edge plain red on focus without a gradient ($name)",
    async (scenario) => {
      await using scene = await mount("city-dark", scenario, true);
      const { host, main } = scene;
      const carrier = scenario.attached ? main : host;

      const edge = visibleEdge(carrier);
      expect(edge.display).toBe("block");
      expect(edge.color).toBe(CITY_EDGE_FOCUS);
      expect(edge.image).toBe("none");
    },
  );

  it("paints the attached banner in the resting edge colour, even on focus", async () => {
    for (const focused of [false, true]) {
      await using scene = await mount("city-dark", SCENARIOS.bannerStrip, focused);
      const { banner, strip } = scene;

      expect(channels(before(banner!).borderLeftColor)).toBe(CITY_EDGE_REST);
      expect(strip).not.toBeNull();
    }
  });

  it("keeps the warning variant tint on its drawer instead of the neutral edge", async () => {
    await using scene = await mount("city-dark", SCENARIOS.approvalStrip, false);
    const { banner } = scene;

    expect(channels(before(banner!).borderLeftColor)).not.toBe(CITY_EDGE_REST);
  });

  it("keeps the context strip silhouette out of the City composer without a strip", async () => {
    await using scene = await mount("city-dark", SCENARIOS.plain, false);
    const { shell } = scene;

    expect(before(shell).display).toBe("none");
  });
});

describe("Default theme composer", () => {
  it("keeps the upstream hand-off from Host to Main and no City clipping", async () => {
    await using scene = await mount("default-dark", SCENARIOS.bannerStrip, true);
    const { host, main, shell } = scene;

    expect(after(host).display).toBe("none");
    expect(after(main).display).toBe("block");
    expect(getComputedStyle(host).clipPath).toBe("none");
    expect(getComputedStyle(main).clipPath).toBe("none");
    expect(before(shell).display).toBe("none");
  });
});
