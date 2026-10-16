import { getTranslations } from "next-intl/server";
import { MessageSquareIcon } from "lucide-react";
import { DateTime } from "@/components/date-time";
import { EmptyState } from "@/components/empty-state";
import type { IntakeMessage } from "@gymcrm/shared/intake";

/** What the person wrote through the connections (the website form, later the messengers), oldest first (M10.1, A-266). */
export async function LeadMessages({ messages }: { messages: IntakeMessage[] }) {
  const t = await getTranslations("intake");
  if (messages.length === 0) return <EmptyState icon={MessageSquareIcon} title={t("noMessages")} />;
  return (
    <ul className="space-y-3">
      {messages.map((message) => (
        <li key={message.id} className="rounded-md border p-3 text-sm">
          <div className="mb-1 flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
            <span>
              {message.senderName ?? "—"} · {message.source.name}
            </span>
            <DateTime value={message.receivedAt} format="dateTime" />
          </div>
          <p className="break-words whitespace-pre-line">{message.body ?? "—"}</p>
        </li>
      ))}
    </ul>
  );
}
