"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { ChevronsUpDownIcon, LogOutIcon } from "lucide-react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { authClient } from "@/lib/auth/auth-client";
import { LOCALES } from "@/i18n/config";
import type { Role } from "@/lib/permissions";
import { setLocaleAction } from "@/app/(crm)/actions";
import { notify } from "@/components/notify";
import { useErrorMessage } from "@/components/use-error-message";

type UserMenuProps = {
  user: { name: string; email: string; role: Role };
};

export function UserMenu({ user }: UserMenuProps) {
  const t = useTranslations();
  const locale = useLocale();
  const router = useRouter();
  const errorMessage = useErrorMessage();
  const [, startTransition] = useTransition();

  const changeLocale = (next: string) => {
    if (next === locale) return;
    startTransition(async () => {
      const result = await setLocaleAction(next);
      if (!result.ok) return void notify.error(errorMessage(result.code));
      router.refresh();
    });
  };

  const signOut = () => {
    startTransition(async () => {
      await authClient.signOut();
      router.replace("/login");
      router.refresh();
    });
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" className="h-9 gap-2 px-2" aria-label={t("userMenu.label")}>
          <Avatar className="size-7">
            <AvatarFallback className="text-xs">{initials(user.name)}</AvatarFallback>
          </Avatar>
          <span className="hidden max-w-40 truncate text-sm sm:inline">{user.name}</span>
          <ChevronsUpDownIcon className="size-4 text-muted-foreground" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-60">
        <DropdownMenuLabel className="font-normal">
          <p className="truncate text-sm font-medium">{user.name}</p>
          <p className="truncate text-xs text-muted-foreground">{user.email}</p>
          <p className="text-xs text-muted-foreground">{t(`roles.${user.role}`)}</p>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuLabel className="text-xs text-muted-foreground">{t("userMenu.language")}</DropdownMenuLabel>
        <DropdownMenuRadioGroup value={locale} onValueChange={changeLocale}>
          {LOCALES.map((value) => (
            <DropdownMenuRadioItem key={value} value={value}>
              {t(`userMenu.${value}`)}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={signOut}>
          <LogOutIcon />
          {t("auth.signOut")}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function initials(name: string): string {
  const words = name.trim().split(/\s+/);
  const letters = words.length > 1 ? words[0][0] + words[words.length - 1][0] : words[0].slice(0, 2);
  return letters.toUpperCase();
}
