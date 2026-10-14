-- M6.2 (brief §8.3, D-036, D-059; FR-MAIL-001, FR-MAIL-002; A-177 to A-180): the text of each customer email is an
-- email template that admin edits, in Vietnamese and English. The events and their placeholders are fixed in the code;
-- the wording is data. The rows below are the texts the system starts with (EMAIL_TEMPLATE_DEFAULTS).
CREATE TABLE "email_templates" (
    "event" TEXT NOT NULL,
    -- For the audit trail, whose records point at a UUID.
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "subject_vi" TEXT NOT NULL,
    "body_vi" TEXT NOT NULL,
    "subject_en" TEXT NOT NULL,
    "body_en" TEXT NOT NULL,
    "updated_by" UUID,
    "updated_at" TIMESTAMPTZ(3),
    CONSTRAINT "email_templates_pkey" PRIMARY KEY ("event"),
    CONSTRAINT "email_templates_texts_check" CHECK (
        length(btrim("subject_vi")) > 0 AND length(btrim("body_vi")) > 0
        AND length(btrim("subject_en")) > 0 AND length(btrim("body_en")) > 0
    )
);

CREATE UNIQUE INDEX "email_templates_id_key" ON "email_templates"("id");

ALTER TABLE "email_templates"
    ADD CONSTRAINT "email_templates_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

INSERT INTO "email_templates" ("event", "subject_vi", "body_vi", "subject_en", "body_en") VALUES
    ('session.credited', $t$Đã ghi nhận 1 buổi tập, hợp đồng {contractCode}$t$, $t$Chào {customerName},

Buổi tập ngày {day} lúc {time} với {trainerName} đã được ghi nhận vào hợp đồng {contractCode}. Số buổi đã dùng: {used}. Số buổi còn lại: {remaining}.

Nếu có điều gì chưa đúng, xin liên hệ phòng tập.$t$, $t$1 session recorded, contract {contractCode}$t$, $t$Hello {customerName},

Your session of {day} at {time} with {trainerName} was recorded on contract {contractCode}. Sessions used: {used}. Sessions left: {remaining}.

If anything looks wrong, please contact the gym.$t$),
    ('session.noShow', $t$Buổi tập vắng được tính vào hợp đồng {contractCode}$t$, $t$Chào {customerName},

Bạn không đến buổi tập ngày {day} lúc {time} với {trainerName}, nên buổi này được tính vào hợp đồng {contractCode}. Số buổi đã dùng: {used}. Số buổi còn lại: {remaining}.

Nếu có điều gì chưa đúng, xin liên hệ phòng tập.$t$, $t$Missed session counted, contract {contractCode}$t$, $t$Hello {customerName},

You did not come to your session of {day} at {time} with {trainerName}, so it was counted on contract {contractCode}. Sessions used: {used}. Sessions left: {remaining}.

If anything looks wrong, please contact the gym.$t$),
    ('session.added', $t$Ghi nhận thêm 1 buổi tập, hợp đồng {contractCode}$t$, $t$Chào {customerName},

Phòng tập vừa ghi nhận thêm 1 buổi tập ngày {day} vào hợp đồng {contractCode}. Số buổi đã dùng: {used}. Số buổi còn lại: {remaining}.

Nếu có điều gì chưa đúng, xin liên hệ phòng tập.$t$, $t$1 session recorded, contract {contractCode}$t$, $t$Hello {customerName},

The gym recorded 1 more session of {day} on contract {contractCode}. Sessions used: {used}. Sessions left: {remaining}.

If anything looks wrong, please contact the gym.$t$),
    ('session.refunded', $t$Hoàn lại 1 buổi tập, hợp đồng {contractCode}$t$, $t$Chào {customerName},

Buổi tập ngày {day} của hợp đồng {contractCode} đã được xóa khỏi lịch sử tập và hoàn lại 1 buổi. Lý do: {reason}. Số buổi còn lại: {remaining}.

Nếu có điều gì chưa đúng, xin liên hệ phòng tập.$t$, $t$1 session refunded, contract {contractCode}$t$, $t$Hello {customerName},

The session of {day} on contract {contractCode} was removed from your training history and 1 session was refunded. Reason: {reason}. Sessions left: {remaining}.

If anything looks wrong, please contact the gym.$t$),
    ('class.attended', $t$Đã ghi nhận 1 buổi lớp {className}, hợp đồng {contractCode}$t$, $t$Chào {customerName},

Bạn đã có mặt ở lớp {className} ngày {day} lúc {time} (HLV {trainerName}); buổi này được tính vào hợp đồng {contractCode}. Số buổi đã dùng: {used}. Số buổi còn lại: {remaining}.

Nếu có điều gì chưa đúng, xin liên hệ phòng tập.$t$, $t$1 class session recorded ({className}), contract {contractCode}$t$, $t$Hello {customerName},

You attended {className} on {day} at {time} (coach {trainerName}); it was counted on contract {contractCode}. Sessions used: {used}. Sessions left: {remaining}.

If anything looks wrong, please contact the gym.$t$);

-- Writing the emails customers get is configuration: Admin's.
INSERT INTO "role_permissions" ("role_id", "permission")
SELECT "id", 'mail.template' FROM "roles" WHERE "code" = 'ADMIN';
