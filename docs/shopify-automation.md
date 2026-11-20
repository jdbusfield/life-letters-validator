# Paid Shopify orders and private survey emails

## What this connects

The Life Letters Shopify store (`0wvdff-u1.myshopify.com`) sends a signed **Order payment** (`orders/paid`) webhook to:

`https://life-letters-survey.onrender.com/webhooks/shopify/orders-paid`

Only configured product IDs qualify. The launch configuration targets **Lowercase Letters Deck**, product `9346367193256`, variant `55322807107752`. Each remaining purchased unit gets its own survey. Two units produce two links in one email. The backend stores the Shopify order ID and line-item ID on each survey. This works without installing a custom Shopify app or obtaining broad Admin API credentials.

The webhook commits surveys and an email job together in Supabase before acknowledging Shopify. Repeated notifications for the same shop/order reuse the original result. The existing paid Render instance polls the durable email queue every 15 seconds; no separate paid worker is required. Database leases also prevent simultaneous workers from independently claiming the same email.

The email service accepts a stable idempotency key per job. Temporary failures retry with backoff, up to eight attempts. Unconfirmed sends older than 20 hours require manual review, keeping automatic retries inside Resend's 24-hour idempotency window. “Email sent to provider” means API acceptance, not confirmed inbox delivery; check the provider dashboard for bounces or delivery events.

## Setup checklist

1. Apply `supabase/migrations/20261115_shopify_order_automation.sql` after the saved-survey migration. Run `test/shopify-automation-database.sql`; it rolls back all test changes.
2. Create or use a Resend account. Verify a Life Letters sending subdomain, such as `mail.life-letters.com`, through the domain's DNS provider. Keep open/click tracking off for private access links. Gmail can remain the reply-to inbox.
3. Store a sending API key as `RESEND_API_KEY`, set `SURVEY_EMAIL_FROM` to the verified sender, and `SURVEY_EMAIL_REPLY_TO=lifelettersco@gmail.com`.
4. Set `SHOPIFY_SHOP_DOMAIN=0wvdff-u1.myshopify.com`, `SHOPIFY_SURVEY_PRODUCT_IDS=9346367193256`, and the existing HTTPS `PUBLIC_BASE_URL` in Render.
5. Generate a separate random secret of at least 32 characters as `SURVEY_LINK_SECRET`. Keep it stable: automatic survey tokens are reconstructed from this secret and immutable order/unit identifiers. Only token hashes, not full access links, are stored in Supabase. Rotating the secret requires reviewing queued emails and replacing affected customer links.
6. In Life Letters Shopify admin, use **Settings → Notifications → Webhooks**. Read the store's webhook signing secret securely into `SHOPIFY_WEBHOOK_SECRET` in Render. This is the merchant webhook secret shown there, not a guessed API key or the ChatGPT connector credential.
7. Deploy and review the admin **Shopify orders & survey emails** readiness panel. Keep `SHOPIFY_AUTOMATION_ENABLED=false` until sender verification, secrets, and a controlled test are ready.
8. Create the **Order payment** JSON webhook at the URL above with a supported API version. Enable automation only when the receiver and sender are ready. The handler verifies HMAC over the original request bytes, the exact store domain, and the topic before storing anything.
9. For a controlled Shopify test order, temporarily enable `SHOPIFY_ACCEPT_TEST_ORDERS=true`, use an email inbox you control, and buy the eligible product through Shopify's test workflow. Confirm one set creates one survey and two sets create two; confirm the email links, resume, final submission, and admin PDF. Return `SHOPIFY_ACCEPT_TEST_ORDERS=false` afterward. A generic “Send test notification” may not contain the eligible product and can correctly be ignored.

## Everyday operations

- The admin **Shopify orders & survey emails** section shows queued, sending, accepted, and attention states. The existing saved-survey list contains the linked surveys.
- Missing customer email or more than 20 sets is recorded for review rather than silently discarded. Correct the customer details in Shopify and create clearly identified manual surveys if necessary, after checking that automatic ones do not already exist.
- For a failed or ambiguous email, check Resend before sending again. Use the existing **Replace private link** action and manual email text when a customer needs a new link. Replacing a link before its queued email sends stops that job for review, so an obsolete link is not mailed.
- Automatic processing covers the first paid event. Later order edits, added quantities, refunds, cancellations after payment, and fulfillment updates need manual review in this release. It does not charge, refund, print, or fulfill Shopify orders.
- Test orders are ignored by default. Unpaid, cancelled-at-payment, and unrelated-product orders are ignored. Existing historical orders are not automatically imported or emailed.
- To pause new processing and email sending, set `SHOPIFY_AUTOMATION_ENABLED=false`. Surveys already created remain available. Disable the Shopify webhook too if the pause will last, so Shopify does not repeatedly retry a disabled receiver.

## Verification

Run the Node suite including `test/shopify-automation.test.js`. It checks raw-body signatures, exact store/topic matching, paid/product gating, per-unit links, duplicate notifications, safe failures, email escaping, stable provider idempotency, replaced-link rejection, and durable send outcomes without making real email requests.

Official references: [Shopify webhook verification](https://shopify.dev/docs/apps/build/webhooks/verify-deliveries), [merchant webhook setup](https://help.shopify.com/en/manual/fulfillment/setup/notifications/webhooks), [Resend sending](https://resend.com/docs/api-reference/emails/send-email), [Resend domain verification](https://resend.com/docs/dashboard/domains/introduction), and [email idempotency](https://resend.com/docs/dashboard/emails/idempotency-keys).
