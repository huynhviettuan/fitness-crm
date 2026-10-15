# 30. Lead channel survey (M10.0)

Brief §11 "Tích hợp kênh lead", D-044, TS-007. This is the report the brief asks the developer for **before** any channel is built:
which channels are feasible, what they cost, and how long app review takes. The owner picks the order; nothing here is built yet.
The Vietnamese version for the owner is `docs/customer/Khao_sat_kenh_lead.docx`.

Evidence: **[official]** = read on the platform's own page on 2026-11-05; **[third party]** = vendor or press, to be confirmed on the
platform's page before building; **[not found]** = could not be confirmed. Prices and review rules change, so each channel slice
starts by re-reading its platform page.

## 1. Summary

| Channel | Feasible | API cost | Review / setup lead time | Effort | Recommended order |
|---|---|---|---|---|---|
| Manual form (calls, walk-ins, partners) | Built (M2) | none | none | done | — |
| Website form | Yes, easy | none | none | S | 1 |
| WhatsApp Business (Cloud API) | Yes | Receiving is free; only **template messages we send** are billed [official] | Business verification and number set-up: days to weeks [third party] | M | 2 (start the paperwork now) |
| Messenger + Instagram DMs | Yes, one Meta app for both | none | **App Review** with a screencast; Advanced Access needed to receive from the public [official + third party] | M | 3 |
| Meta Lead Ads (Facebook/Instagram Instant Forms) | Yes, if the gym runs lead ads | none | `leads_retrieval` review [third party] | S | with 3 if used |
| Gmail forwarding | Yes | A few USD a month at most [third party] | none | S | 4 |
| Zalo Official Account (receive only) | Yes, with a verified OA | OA package, amount to confirm [third party, 2022 prices] | OA verification, about 7 working days [third party] | M | 5 |
| TikTok | Only **Instant Form leads** (lead ads); no general DM API found [third party] | none for the API | TikTok for Business account | S–M | later |
| Threads | **No** messaging API found [third party] | — | — | — | manual |
| Google Maps, Google Ads, ChatGPT, referrals | They are **sources**, not channels (D-044) | — | — | — | manual |

Effort: S = one short slice, M = one slice plus waiting for review.

## 2. The gateway first (M10.1)

Every channel hands us a message or a form. One **intake gateway** takes them all: a webhook endpoint per channel that checks the
sender's signature, ignores a message it has seen (idempotency by the platform's message id), stores the conversation on the
lead (M11 needs it), and maps it to the lead intake with its channel (D-060: a name and a channel are enough; the phone comes later,
and a returning customer is matched by phone when it is given, D-019). The lead goes to the next consultant in turn (D-050).
A channel then adds only its own parser and signature check. No new infrastructure: the API and the pg-boss worker already there
(T-041, T-045).

## 3. Channel by channel

### Website form
A form on the gym's site posts to an endpoint of ours with a shared secret and a honeypot field; rate limited like the other public
endpoints. Needs from the owner: what the website is built with and whether the form can post to a URL. Cost none.

### WhatsApp Business (Cloud API)
- **Receiving works by webhook** [official]; the Cloud API is the route Meta documents.
- **Cost, from Meta's pricing page** [official]: since 1 July 2025 only **delivered template messages** are billed, by category and
  the recipient's country code. Non-template messages are free inside the 24-hour window that opens when the customer writes;
  utility templates inside the window are free; a customer who comes from a Click-to-WhatsApp ad or a Facebook Page button gets a
  72-hour window in which replies are free. The old "free service conversations" were part of the conversation-based model, which
  is withdrawn. One reseller blog claims service messages become billable again on 1 October 2026; Meta's page does not say so
  [not found]. **Phase 1 only receives**, so no template is sent and the expected cost is nil; replying from the system, if it is
  wanted later, would use free-form replies inside the window.
- **The decision that matters:** a phone number used by the Cloud API can't be used at the same time in the ordinary WhatsApp
  Business app on a phone [third party; whether a "coexistence" mode applies to this account is to be confirmed with Meta]. If staff
  answer from the app today, either the gym uses a **new number** for the API (and the old one stays manual), or staff answer from
  our system (a later slice with a reply box). This is OQ-071.
- **Set-up:** a Meta Business account of the gym (business verification with company documents), a WhatsApp Business Account, a
  display name approved by Meta, and our webhook address. Lead time: days to weeks.

### Messenger and Instagram
- One **Meta app** serves both. Permissions: `pages_messaging`, `pages_show_list`, `pages_manage_metadata`, `pages_read_engagement`,
  `business_management` for Messenger; `instagram_basic` and `instagram_manage_messages` added for Instagram [official: Meta's
  Messenger Platform overview]. Meta also has an Instagram-Login variant with `instagram_business_manage_messages`; the app
  dashboard shows which applies [third party].
- **App Review**: Standard Access only serves people with a role on the app or Page; to receive messages from the public the app
  needs **Advanced Access**, which requires review with a screencast of a Page admin logging in and granting access [official].
  Business verification is usually part of it; **not confirmed here** [not found].
- The Instagram account must be a **Professional account linked to a Facebook Page**, and its owner must allow connected tools to
  manage messages [third party]. The API returns only the most recent messages of a conversation [official], so we store what we receive.
- **Meta Lead Ads** (Instant Forms on Facebook and Instagram) are a separate feed through the same app: a `leadgen` webhook carries only
  a lead id, and a second authenticated call fetches the fields; it needs `leads_retrieval` [third party]. Worth building if the gym
  buys Meta lead ads: those leads are the *Paid* source of the lead analysis.
- Cost: none for the API.

### Gmail forwarding
Two ways: the gym adds a **forwarding rule** to an address we give, received by an inbound-mail service that posts each message to a
webhook (the sender, subject, text and attachments, with SPF/DKIM results) [third party]; or we **read the mailbox** over IMAP/OAuth.
The first needs no access to the mailbox and is the proposal. Email has no fixed form, so the lead is created from the sender and
the subject, the body is kept as the first message, and the consultant completes the profile. Cost: free tiers or a few USD a month.

### Zalo Official Account (receive only, D-036)
- The OA API can deliver a customer's messages to a webhook; we would **not send** through Zalo (D-036).
- It needs an **OA verified** by Zalo (company documents; about 7 working days [third party]) and a developer app on
  developers.zalo.me. OA packages are paid; the only figures found are the 2022 press ones (10,000 / 59,000 / 399,000 VND a month)
  [third party, old]. **Update 2026-11-11 (M10.6):** the OA webhook was read on developers.zalo.me (*Webhook → Tin nhắn*): events `user_send_*` and `user_submit_info`, signed `X-ZEvent-Signature: mac = sha256(appId + data + timeStamp + OAsecretKey)`, 200 within 2 seconds, resent only when Zalo cannot connect [official]; built as A-294 to A-300. (Before: could not be read from here; the slice was to start by reading
  the official page.) Do not confuse it with Zalo's separate *Bot* product, whose webhook differs.

### TikTok and Threads
- TikTok: leads from **Instant Forms (lead ads)** reach a CRM by webhook through the TikTok for Business lead API [third party]. Messages
  to the gym's TikTok account have no general API that we found [not found]. So: build only if the gym runs TikTok lead ads.
- Threads: no messaging API found [third party]; manual entry.

## 4. Order we propose

1. **M10.1 the gateway**, then the **website form** (smallest, proves the gateway).
2. **WhatsApp**, because the brief says it brings the most leads; the paperwork can start now.
3. **Messenger + Instagram** (one app, one review), with **Lead Ads** if the gym uses them.
4. **Gmail forwarding.**
5. **Zalo OA** (receive only).
6. TikTok lead ads when the gym runs them; Threads stays manual.

Start the **long waits** now, whatever the order: Meta business verification and the Zalo OA verification take time and are the
owner's to start (company documents).

## 5. What we need from the owner

OQ-071: (1) the order above, or another; (2) the WhatsApp number: new for the API, or the current one (and then who answers, in
the app or in our system); (3) who can start Meta business verification, and who owns the Facebook Page, the Instagram account and
the Zalo OA; (4) the website and whether its form can post to a URL; (5) the mailbox for forwarding; (6) whether the gym runs
Meta or TikTok lead ads; (7) rough messages per month per channel, to check cost; (8) whether staff should later **reply** from
the system or keep using each app; (9) the domain for the webhook addresses (staging and production).

## 6. Sources

- Meta, [WhatsApp Business Platform pricing](https://developers.facebook.com/docs/whatsapp/pricing) [official]
- Meta, [Messenger Platform overview](https://developers.facebook.com/documentation/business-messaging/messenger-platform/overview) [official]
- Infobip, [Zalo get started](https://www.infobip.com/docs/zalo/get-started) and [Zalo for business](https://www.infobip.com/blog/zalo-business); Tuổi Trẻ, [Zalo account fee](https://news.tuoitre.vn/zalos-account-registration-fee-sparks-debate-among-users-10384839.htm) [third party]
- Make, [TikTok Lead Forms](https://www.make.com/en/help/app/tiktok-lead-forms); SleekFlow, [TikTok Instant Forms](https://sleekflow.io/channels-integrations/tiktok-instant-form-whatsapp) [third party]
- Elev8or, [Threads bot](https://www.elev8or.io/engage/threads-bot) [third party]
- LeadSync, [Meta lead gen API guide](https://leadsync.me/blog/meta-lead-gen-api-guide/); Webhook Relay, [email to webhook](https://webhookrelay.com/blog/receive-emails-as-webhooks/) [third party]
