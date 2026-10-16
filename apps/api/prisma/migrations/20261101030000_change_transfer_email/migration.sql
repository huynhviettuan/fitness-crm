-- M8.3 (D-036): the email to the customer who gave a contract away also says the sessions left, like every email that moves a
-- session count.
UPDATE "email_templates" SET
    "body_vi" = replace("body_vi", 'không còn thuộc hợp đồng của bạn. Các buổi', 'không còn thuộc hợp đồng của bạn. Số buổi còn lại: {remaining}. Các buổi'),
    "body_en" = replace("body_en", 'are no longer on your contract. Sessions booked', 'are no longer on your contract. Sessions left: {remaining}. Sessions booked')
WHERE "event" = 'change.transferOut';
