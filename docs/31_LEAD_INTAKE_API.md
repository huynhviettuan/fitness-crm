# 31. Lead intake API (website form)

Brief §11, D-044, TS-007; built in M10.1. For whoever builds or configures the form on the gym's website (or a tool such as Make,
Zapier or a WordPress form plugin that can post to a URL). WhatsApp is in §6, Messenger and Instagram in §7, Lead Ads forms in §8, Gmail forwarding in §9, Zalo OA in §10. The other channels (Messenger, Instagram, Gmail, Zalo)
will have their own endpoints in later slices (doc 30).

## 1. Get a key

Admin opens **Cấu hình → Nguồn nhận lead** (`/admin/intake`), adds a source (name, branch, contact channel, optionally the lead
source) and copies the key it shows **once**. The key looks like `fci_…`. Only its hash is stored; if it is lost, **Đổi khóa** makes
a new one and the old one stops working at once. A source can be turned off.

**The key must stay on the website's server.** Never put it in the page's HTML or JavaScript, where a visitor can read it. The
form posts to the website's own server (or to the tool), and that server calls this API.

## 2. The call

```bash
curl -X POST https://<api host>/api/v1/intake/website \
  -H "content-type: application/json" \
  -H "x-intake-key: fci_..." \
  -d '{
    "externalId": "form-2026-11-05-00123",
    "name": "Nguyễn Văn An",
    "phone": "0909 123 456",
    "email": "an@example.com",
    "message": "Tôi muốn tập PT buổi tối",
    "pageUrl": "https://flow.vn/pt"
  }'
```

| Field | Required | Notes |
|---|---|---|
| `externalId` | yes | The form's own id for this submission (at most 200 characters). **Sending the same id again makes no second lead** |
| `name` | yes | At most 150 characters, no control characters |
| `phone` | no | 8 to 15 digits, spaces and dots are fine; a phone that already has a record adds the submission to that person |
| `email` | no | A valid address |
| `message` | no | At most 4,000 characters; line breaks are kept |
| `pageUrl` | no | The page the form was on; kept with the message |

No other field is accepted (a field that is not listed is a `400`). The body must be JSON.

## 3. The answer

`200` with:

```json
{ "personId": "…", "stage": "LEAD", "code": "LD000123", "duplicate": false, "existingPerson": false }
```

- `duplicate: true`: this `externalId` was seen before; nothing was created, and the answer names the person it made.
- `existingPerson: true`: the phone already had a record (lead or customer); the submission was added to it as an inquiry (BR-202) and
  the consultant is told. No second person is made (D-019).
- A new lead is given to the next consultant in turn (D-050), in the source's branch, under its contact channel.

| Status | Meaning | What to do |
|---|---|---|
| `400` `VALIDATION_FAILED` | A field is missing or wrong (`details.fieldErrors`) | Fix the form; do not retry unchanged |
| `401` `UNAUTHENTICATED` | No key, a wrong key, a replaced key, or the source is off | Check the key |
| `409` `INTAKE_IN_PROGRESS` | The same `externalId` is being handled right now | Retry in a few seconds |
| `415` | The body is not JSON | Send `content-type: application/json` |
| `429` `RATE_LIMITED` | More than 60 submissions a minute from this source | Slow down and retry |
| `5xx` | A fault on our side; nothing was kept | Retry with the same `externalId` |

## 4. What happens to it

The submission is stored as a **message** on the lead (the "Tin nhắn nhận được" card of the lead page), with the name, the text, the
page and the time, whoever later changes the lead's profile. The conversation stays on the person when the lead becomes a customer.

## 5. Limits

One API process counts the 60 a minute, so the limit is approximate if the API is scaled out. A browser posting directly to this
endpoint is refused (it has no key and its Origin is not the app's); that is on purpose.

## 6. WhatsApp (M10.2)

For whoever holds the gym's Meta (Facebook) developer account. The system never calls WhatsApp in this slice; it only receives what
customers write to the gym's WhatsApp Business number.

1. In Meta's developer console create (or open) the app with the **WhatsApp** product and note its **App Secret** (App settings →
   Basic).
2. Admin opens **Cấu hình → Nguồn nhận lead**, **Thêm nguồn**, kind **WhatsApp**, pastes the App Secret and registers. The system shows
   once the **Callback URL** (`https://<web host>/api/v1/intake/whatsapp/<source id>`) and the **Verify token**.
3. In the app's WhatsApp → Configuration, paste both into **Webhook** and verify; then subscribe to the **messages** field.
4. A customer's message to the number now arrives in the system.

What happens: the number is stored the way the gym stores phones (`84909123456` → `0909123456`), a known phone is found, a new one
becomes a lead named after the WhatsApp profile; a customer who writes again within 24 hours stays in the same conversation (one
lead; the person in charge gets the *new inquiry* notification), and after 24 hours it is a new inquiry on the same person.
Pictures, voice notes and locations are kept as their kind (`[image]`), without the file. Each message is taken in once, however many
times Meta delivers it.

Every delivery is checked against its `x-hub-signature-256` before anything is read; a delivery that fails is `401` and nothing is
kept. The App Secret is stored encrypted and is not shown again; the Verify token is replaced with **Đổi khóa** (it is only needed to
register the webhook again). To change the App Secret, register a new source and switch the old one off. WhatsApp's own rules (a
business account, an approved display name, billing for template messages we may send in a later slice) are the gym's to handle with
Meta (doc 30).

## 7. Messenger and Instagram (M10.3)

The same Meta app can carry the Facebook Page's messages (Messenger) and the Instagram account's (Instagram messaging). Register **one
source per Page and one per Instagram account**, each with the app's App Secret.

1. In the Meta app add the **Messenger** product (and **Instagram** for the account), connect the Page or the account, and ask for the
   messaging permissions in App Review (`pages_messaging`, `instagram_manage_messages`).
2. Admin registers a source of kind **Messenger** or **Instagram** with the App Secret; the system shows once the **Callback URL**
   (`https://<web host>/api/v1/intake/meta/<source id>`) and the **Verify token**.
3. Paste both into the product's **Webhooks** and subscribe the Page (or account) to the **messages** field.

What happens: Messenger and Instagram give no phone and no name, only an id of the sender for that Page or account. A new sender
becomes a lead called *Messenger 654321* (the last six digits of the id), with no phone; the consultant renames it and adds the
phone once they know the person, or merges it into the record the person already has. Later messages of the same sender go to that
person, also after a merge. Within 24 hours a message joins the conversation; after that it is a new inquiry. The Page's own
replies are not taken in. Lead Ads forms are not read yet.

## 8. Lead Ads forms (M10.4)

Facebook and Instagram lead ads (Instant Forms) are delivered to the **Facebook Page's** webhook, so they come through the Page's
Messenger source (§7).

1. Register the Page's **Messenger** source (§7) and, in the Meta app's Page webhook, subscribe also to the **leadgen** field.
2. Generate a **long-lived Page access token** with the `leads_retrieval` permission (and `pages_manage_metadata`, `pages_show_list`)
   for the Page, after App Review.
3. Admin opens **Cấu hình → Nguồn nhận lead**, on the Messenger source clicks **Token Trang**, pastes the token and saves. The column
   *Lead Ads* shows **Đang nhận**. The token is stored encrypted and is never shown again; paste a new one to replace it.
4. **Set the token before the ads go live**: form leads that arrive while the source has no token are skipped.

What happens: for each new form lead the system asks Meta for the answers (with the token, in the request header) and makes a lead
from the name, phone and email, or adds an inquiry to the person who already has the phone. The other questions are kept as lines
*question: answer* in the lead's note and in its messages. Set the Messenger source's **lead source** to the one that counts paid
leads (for example *Paid*), so the lead analysis shows them. If Meta cannot answer, the delivery fails and Meta sends it again.

## 9. Gmail forwarding (M10.5)

The gym's Gmail forwards customer enquiries to an **inbound-mail service** (Postmark Inbound), which posts each email to the system.
Nobody gives the system access to the mailbox.

1. Admin opens **Cấu hình → Nguồn nhận lead**, **Thêm nguồn**, kind **Gmail**, and registers. The system shows once the **key** and
   the **inbound address**: `https://flow:<key>@<web host>/api/v1/intake/email` (the key is the password in the address).
2. In Postmark, create an inbound stream and paste the inbound address as its **webhook URL**. Postmark gives an inbound email address
   (`…@inbound.postmarkapp.com`).
3. In the gym's Gmail, **Settings → Forwarding**, add that Postmark address. Gmail sends it a confirmation email: it appears in the
   system under the source's name (*Thông báo mới nhất*), with the code to type into Gmail. Then turn forwarding on (or create a Gmail
   filter that forwards only the enquiries).

What happens: an email a person wrote becomes a message of the person with that address, else of the person with the phone written
in it (`0909 123 456`), else of a new lead named after the sender, with the address and that phone. Within 24 hours of their last
email it joins the conversation; later it is an inquiry. Auto-replies, newsletters, bounces and Gmail's own confirmation make no lead.
Attachments are listed by name, not kept. An email over 8 MB is refused.

## 10. Zalo OA (M10.6)

The system **receives** what users write to the gym's Zalo Official Account; it never sends through Zalo (D-036).

1. On developers.zalo.me, open (or create) the app linked to the OA and grant it the OA's access. Note the **App ID** and, under the
   Official Account settings, the **OA Secret Key**.
2. Verify the domain of the web app with Zalo (the DNS record Zalo gives, in the app's domain settings).
3. Admin opens **Cấu hình → Nguồn nhận lead**, **Thêm nguồn**, kind **Zalo OA**, enters the App ID and the OA Secret Key, and
   registers. The system shows once the **webhook address** (`https://<web host>/api/v1/intake/zalo/<source id>`).
4. Paste it as the app's **Webhook URL** and turn on the events *người dùng gửi tin nhắn* (all kinds) and *người dùng đồng ý chia sẻ
   thông tin*. Leave *Lọc cú pháp* off.

What happens: Zalo gives no phone and no name with a message, only the user's id for the OA. A new user becomes a lead called
*Zalo 197922* (the last six digits of the id); the consultant renames it, adds the phone, or merges it with the person's record.
When a user shares their information through the OA, the name and phone come with it: the person with that phone gets the message,
or a new lead is made with them. Within 24 hours a message joins the conversation; after that it is a new inquiry. Pictures and files
are kept as their kind or name. Zalo does not send an event again after an error, so a failed event is logged for Admin.
