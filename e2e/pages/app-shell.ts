import type { Locator, Page } from "@playwright/test";
import { labels } from "../support/labels";

/** The signed-in layout: sidebar, top bar, and the page's main region. */
export class AppShell {
  constructor(private readonly page: Page) {}

  get sidebar(): Locator {
    return this.page.locator('[data-sidebar="sidebar"]');
  }

  get main(): Locator {
    return this.page.getByRole("main");
  }

  navLink(name: string): Locator {
    return this.sidebar.getByRole("link", { name, exact: true });
  }

  /** A group's button in the sidebar (A-105); it carries aria-expanded. */
  groupButton(name: string): Locator {
    return this.sidebar.getByRole("button", { name, exact: true });
  }

  /** Opens every closed group so each link can be checked: the sidebar opens only the group of the page itself. */
  async expandNav(): Promise<void> {
    const closed = this.sidebar.locator('[aria-expanded="false"]');
    while ((await closed.count()) > 0) await closed.first().click();
  }

  /** The page's full width; wider than the viewport means sideways scrolling (AC-23). */
  async scrollWidth(): Promise<number> {
    return this.page.evaluate(() => document.documentElement.scrollWidth);
  }

  pageHeading(name: string): Locator {
    return this.main.getByRole("heading", { level: 1, name });
  }

  /** Opens the Ctrl+K customer search and returns its dialog. */
  async openCustomerSearch(): Promise<Locator> {
    await this.page.getByRole("banner").getByRole("button", { name: labels.search.trigger }).click();
    return this.page.getByRole("dialog", { name: labels.search.title });
  }
}
