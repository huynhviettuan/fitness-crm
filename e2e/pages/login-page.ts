import type { Locator, Page } from "@playwright/test";
import { labels } from "../support/labels";

export class LoginPage {
  private readonly form: Locator;

  constructor(private readonly page: Page) {
    this.form = page.getByRole("main").locator("form");
  }

  async goto(): Promise<void> {
    await this.page.goto("/login");
  }

  async signIn(email: string, password: string): Promise<void> {
    await this.form.getByLabel(labels.auth.email).fill(email);
    await this.form.getByLabel(labels.auth.password).fill(password);
    await this.form.getByRole("button", { name: labels.auth.submit }).click();
  }

  get error(): Locator {
    return this.form.getByRole("alert");
  }
}
