-- M6.4 (D-053, D-056; A-183 to A-187): staff are told outside the system. The important notifications also go by email and,
-- to an employee who has the app on a phone, as a push; each employee chooses per kind and channel, and Admin marks the
-- kinds that are mandatory. A delivery is one channel of one notification, tried again like the customer emails.

-- What each employee chose, per kind of notification. No row means both channels are on.
CREATE TABLE "notification_preferences" (
    "user_id" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "email" BOOLEAN NOT NULL,
    "push" BOOLEAN NOT NULL,
    CONSTRAINT "notification_preferences_pkey" PRIMARY KEY ("user_id", "kind")
);

-- What Admin made mandatory, per kind (the kinds are in the code; this is only the marks).
CREATE TABLE "staff_notification_settings" (
    "kind" TEXT NOT NULL,
    "email_mandatory" BOOLEAN NOT NULL DEFAULT false,
    "push_mandatory" BOOLEAN NOT NULL DEFAULT false,
    "updated_by" UUID,
    "updated_at" TIMESTAMPTZ(3),
    CONSTRAINT "staff_notification_settings_pkey" PRIMARY KEY ("kind")
);

-- The overdue ones start mandatory by email: a missed deadline or an approval nobody answers must not be switched off.
INSERT INTO "staff_notification_settings" ("kind", "email_mandatory", "push_mandatory") VALUES
    ('taskDueSoon', false, false),
    ('taskOverdue', true, false),
    ('approvalSubmitted', false, false),
    ('approvalOverdue', true, false),
    ('leadAssigned', false, false),
    ('leadReclaimed', false, false),
    ('sessionHanging', true, false);

-- A phone or browser that accepted push (the Web Push API); one row per device, which belongs to one account.
CREATE TABLE "push_subscriptions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "endpoint" TEXT NOT NULL,
    "p256dh" TEXT NOT NULL,
    "auth" TEXT NOT NULL,
    "user_agent" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "push_subscriptions_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "push_subscriptions_endpoint_key" ON "push_subscriptions"("endpoint");
CREATE INDEX "push_subscriptions_user_id_idx" ON "push_subscriptions"("user_id");

-- One channel of one notification: its status and its retries.
CREATE TABLE "notification_deliveries" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "notification_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "channel" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'QUEUED',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "next_attempt_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "failure" TEXT,
    "sent_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "notification_deliveries_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "notification_deliveries_channel_check" CHECK ("channel" IN ('EMAIL', 'PUSH')),
    CONSTRAINT "notification_deliveries_status_check" CHECK ("status" IN ('QUEUED', 'SENT', 'FAILED', 'SKIPPED'))
);
-- A notification goes out once by each channel, however often the request that made it is repeated.
CREATE UNIQUE INDEX "notification_deliveries_notification_id_channel_key"
    ON "notification_deliveries"("notification_id", "channel");
CREATE INDEX "notification_deliveries_status_next_attempt_at_idx"
    ON "notification_deliveries"("status", "next_attempt_at");

ALTER TABLE "notification_preferences"
    ADD CONSTRAINT "notification_preferences_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "staff_notification_settings"
    ADD CONSTRAINT "staff_notification_settings_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "push_subscriptions"
    ADD CONSTRAINT "push_subscriptions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "notification_deliveries"
    ADD CONSTRAINT "notification_deliveries_notification_id_fkey" FOREIGN KEY ("notification_id") REFERENCES "notifications"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    ADD CONSTRAINT "notification_deliveries_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
