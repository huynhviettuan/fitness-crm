# 29 — Staff push notifications: proposal and limits

Written for M6.4 (D-053, D-056, A-183 to A-187), as the slice plan asked: the way comes first, then the build. The
customer asked that staff are told outside the system, by email and by a push to the phone when they are signed in on one.

## The way: the web app on the home screen

Phase 1 has no native app (D-013, T-041). The CRM is a web app, so the phone gets **Web Push**: the browser itself
receives the push from its vendor's push service (Google, Apple, Mozilla) and shows it, even when the CRM is closed.

What is built:

1. **A home-screen app.** `manifest.webmanifest` lets an employee add the CRM to the Home Screen; it opens full screen
   as "Flow CRM" and starts on the dashboard. The icons are plain until the owner supplies the logo.
2. **A service worker** (`/sw.js`) that only shows a push and opens the page it is about. It caches nothing and stores
   nothing; only a page of this site can be opened from a push.
3. **A subscription per device.** On *Thông báo của tôi* (user menu) the employee turns notifications on for **this**
   phone or browser; the browser asks permission once. The subscription (an endpoint and two keys) is stored against the
   employee's account, one row per device, and removed when the employee turns it off or the push service says the device
   is gone (404, 410).
4. **Sending by the server**, signed with a VAPID key pair (one per environment, in the server's settings, never in
   the repository), through the `web-push` library behind one small interface. A push carries only a title, one
   sentence and a page address; nothing private beyond what the in-app notification says.
5. **Choices.** Each employee turns email and push on or off for each kind of notification; Admin marks the kinds that
   are mandatory by email or by push (D-053).

## What it needs from the owner

- The sending **domain** is the one already used for the customer emails; the staff emails use the same provider
  (Resend) and sender. Nothing new to buy.
- The **VAPID** key pair: generated once per environment by `npx web-push generate-vapid-keys`, and the contact address
  the push services can reach the operator at (`VAPID_SUBJECT`, for example `mailto:ops@…`).
- The **logo** for the home-screen icon (a square PNG, 512 × 512 or larger).

## Limits, by phone

| | Android (Chrome, Edge, Samsung Internet, Firefox) | iPhone and iPad (Safari) |
|---|---|---|
| Works in the browser tab | Yes | **No.** Push works only for an app added to the Home Screen |
| Needs | Allow notifications once | iOS **16.4 or later**; Share → *Add to Home Screen*; open the app from its new icon; allow notifications there |
| Installed apps | Not required, but available | Required |
| Phone off or offline | The push service keeps the message for an hour (TTL 3,600 s), then drops it | Same |
| Quiet hours and Focus modes | The phone's own settings decide | The phone's own settings decide; a Focus mode can hold pushes |
| Several devices | One push to each device of the account | Same |
| Sign-out | The subscription stays until turned off; a push to a phone whose employee signed out would still arrive, so the employee turns it off on the phone, or Admin disables the account (the push is then skipped) | Same |
| Browser data cleared | The subscription is gone; the employee turns it on again | Same; deleting the Home Screen app removes it |
| Private browsing, some in-app browsers | No push | No push |

Where push cannot work, **email still does**: an employee who has no device turned on gets the email, and a notification
is never sent only by push. A notification the employee has already read in the app is not sent.

## Why not the alternatives

- **A native app** (store distribution, review, accounts): out of phase 1 and out of the budget; the web app on the home
  screen gives the same push for phones that support it.
- **SMS or Zalo**: a cost per message, and Zalo OA is out of phase 1 (D-013, D-036).
- **A third-party push service** (OneSignal, Firebase): one more vendor holding staff identities and device tokens; the
  Web Push standard needs none.

## Tested how

The push service is mocked at its boundary (the `web-push` library) in the integration tests, as the mail provider is:
the choices, the mandatory marks, the retries (1, 5, 30 minutes), a dropped device, and a notification already read are
covered there. The browser's permission prompt and a real push cannot run in the test browser; they are checked by hand
on one Android phone and one iPhone on staging before M6 closes.
