-- M6.3 (D-036, D-059; A-181, A-182): the optional customer emails (contract activated or renewed, receipt, hold, active
-- again, cancelled, expiring, running out of sessions) and the switch that turns each one off. A mandatory event ignores
-- the switch (the code knows which they are); every event starts on.
ALTER TABLE "email_templates" ADD COLUMN "enabled" BOOLEAN NOT NULL DEFAULT true;

INSERT INTO "email_templates" ("event", "subject_vi", "body_vi", "subject_en", "body_en") VALUES
    ('contract.activated', $t$Hợp đồng {contractCode} đã được kích hoạt$t$, $t$Chào {customerName},

Hợp đồng {contractCode} ({packageName}) đã được kích hoạt. Hiệu lực từ {startDate} đến {endDate}, tổng {totalSessions} buổi.

Nếu có điều gì chưa đúng, xin liên hệ phòng tập.$t$, $t$Contract {contractCode} is active$t$, $t$Hello {customerName},

Contract {contractCode} ({packageName}) is now active, from {startDate} to {endDate}, {totalSessions} sessions in all.

If anything looks wrong, please contact the gym.$t$),
    ('contract.renewed', $t$Hợp đồng tái ký {contractCode} đã được kích hoạt$t$, $t$Chào {customerName},

Cảm ơn bạn đã tái ký. Hợp đồng {contractCode} ({packageName}) đã được kích hoạt, hiệu lực từ {startDate} đến {endDate}, tổng {totalSessions} buổi.

Nếu có điều gì chưa đúng, xin liên hệ phòng tập.$t$, $t$Renewal {contractCode} is active$t$, $t$Hello {customerName},

Thank you for renewing. Contract {contractCode} ({packageName}) is now active, from {startDate} to {endDate}, {totalSessions} sessions in all.

If anything looks wrong, please contact the gym.$t$),
    ('payment.received', $t$Đã nhận {amount}, phiếu thu {receiptNumber}$t$, $t$Chào {customerName},

Phòng tập đã nhận {amount} ngày {day} cho hợp đồng {contractCode} (phiếu thu {receiptNumber}). Tổng đã thanh toán: {paidTotal}. Còn lại: {debt}.

Nếu có điều gì chưa đúng, xin liên hệ phòng tập.$t$, $t$Received {amount}, receipt {receiptNumber}$t$, $t$Hello {customerName},

The gym received {amount} on {day} for contract {contractCode} (receipt {receiptNumber}). Total paid: {paidTotal}. Still owed: {debt}.

If anything looks wrong, please contact the gym.$t$),
    ('contract.deactivated', $t$Hợp đồng {contractCode} được tạm ngưng$t$, $t$Chào {customerName},

Hợp đồng {contractCode} được tạm ngưng từ {day}. Lý do: {reason}. Trong thời gian này không có buổi tập nào bị tính. Khi hoạt động lại, phòng tập sẽ báo ngày hết hạn mới.

Nếu có điều gì chưa đúng, xin liên hệ phòng tập.$t$, $t$Contract {contractCode} is on hold$t$, $t$Hello {customerName},

Contract {contractCode} is on hold from {day}. Reason: {reason}. No session is counted meanwhile. The gym will tell you the new end date when it is active again.

If anything looks wrong, please contact the gym.$t$),
    ('contract.reactivated', $t$Hợp đồng {contractCode} hoạt động lại, hết hạn {endDate}$t$, $t$Chào {customerName},

Hợp đồng {contractCode} đã hoạt động lại từ {day}. Số ngày được cộng thêm: {addedDays}. Ngày hết hạn mới: {endDate}. Số buổi còn lại: {remaining}.

Nếu có điều gì chưa đúng, xin liên hệ phòng tập.$t$, $t$Contract {contractCode} is active again, ends {endDate}$t$, $t$Hello {customerName},

Contract {contractCode} is active again from {day}. Days added: {addedDays}. New end date: {endDate}. Sessions left: {remaining}.

If anything looks wrong, please contact the gym.$t$),
    ('contract.cancelled', $t$Hợp đồng {contractCode} đã hủy$t$, $t$Chào {customerName},

Hợp đồng {contractCode} ({packageName}) đã được hủy ngày {day}.

Nếu có điều gì chưa đúng, xin liên hệ phòng tập.$t$, $t$Contract {contractCode} cancelled$t$, $t$Hello {customerName},

Contract {contractCode} ({packageName}) was cancelled on {day}.

If anything looks wrong, please contact the gym.$t$),
    ('contract.expiring', $t$Hợp đồng {contractCode} sắp hết hạn$t$, $t$Chào {customerName},

Hợp đồng {contractCode} ({packageName}) sẽ hết hạn ngày {endDate}, còn {daysLeft} ngày. Số buổi còn lại: {remaining}. Hãy liên hệ phòng tập để sắp xếp lịch hoặc tái ký.

Nếu có điều gì chưa đúng, xin liên hệ phòng tập.$t$, $t$Contract {contractCode} is ending soon$t$, $t$Hello {customerName},

Contract {contractCode} ({packageName}) ends on {endDate}, in {daysLeft} days. Sessions left: {remaining}. Please contact the gym to book your sessions or renew.

If anything looks wrong, please contact the gym.$t$),
    ('contract.runningOut', $t$Hợp đồng {contractCode} sắp hết buổi$t$, $t$Chào {customerName},

Hợp đồng {contractCode} ({packageName}) chỉ còn {remaining} buổi, hiệu lực đến {endDate}. Hãy liên hệ phòng tập để tái ký.

Nếu có điều gì chưa đúng, xin liên hệ phòng tập.$t$, $t$Contract {contractCode} is running out of sessions$t$, $t$Hello {customerName},

Contract {contractCode} ({packageName}) has only {remaining} sessions left and runs until {endDate}. Please contact the gym to renew.

If anything looks wrong, please contact the gym.$t$);
