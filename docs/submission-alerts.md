# Completed survey notifications

New survey submissions queue an internal email to `contact@life-letters.com` so the team knows a set is ready for review. These notifications use the existing Resend account and paid Render web service. They do not email the customer or attach customer photos/PDFs.

## Setup

1. Apply `supabase/migrations/20261117_submission_alerts.sql` after the saved-survey migration. It creates a private queue and adds a trigger inside the existing submission transaction. It does not backfill historical submissions.
2. Run `test/submission-alerts-database.sql`. All test data and temporary queue changes roll back.
3. Deploy the notification worker and admin panel.
4. Set `SURVEY_SUBMISSION_EMAIL_TO=contact@life-letters.com` and `SURVEY_SUBMISSION_ALERTS_ENABLED=true`. The worker reuses `RESEND_API_KEY`, `SURVEY_EMAIL_FROM`, and `PUBLIC_BASE_URL`. No new secret or paid service is needed.
5. Submit a clearly named test survey. Confirm one queue row, one accepted email, delivered status in Resend, and the admin dashboard link. Submitting the same revision again must not queue another notification.

## Behavior and limits

- One email job is created per set and submitted revision, atomically with the submission. Reopening cancels queued older notifications; resubmission creates a new revision's notification. An email already sent cannot be recalled.
- A poll runs every 15 seconds. Database leases prevent overlapping workers from claiming the same job. The recipient is frozen on the first attempt so retries keep the same payload and idempotency key.
- Temporary failures retry with backoff. Permanent failures, exhausted attempts, and uncertain sends older than 20 hours require review. Do not blindly resend: check Resend first. The provider's duplicate protection lasts 24 hours.
- Admin > Completed survey notifications shows queued, sending, sent-to-provider, cancelled/superseded, and attention states. Refresh after a submission. Provider acceptance does not establish inbox delivery.
- The notification links to authenticated `/admin`; no private survey token, customer photo, or PDF attachment is sent. The PDF may still be generating when the alert arrives.
- Setting the enabled flag to false pauses sending but retains queued jobs. The setting is separate from the Shopify purchase automation flag.
- A cancellation or refund after payment is still a manual review in this release. The notification does not verify Shopify payment again, issue refunds, place print orders, or fulfill a Shopify order.

## Daily order checklist

1. Check the contact inbox, submitted orders, and both email queue panels for attention states.
2. Confirm payment and current cancellation/refund status in Shopify. Match the order reference and the purchased set count to the surveys; never prepare cancelled test orders.
3. Open the submitted cards and review all 26 letter/photo/word combinations. Check names, phonics, image quality, and the final card design. Resolve any reopened draft before starting production.
4. Download and inspect the current PDF. Mark the set In Progress only after approval to prepare it. Order the approved print proof manually in Canva; record its ETA and cost.
5. On arrival, check all fronts/backs, assemble and package the complete set, then mark Printed.
6. Ship to the address verified in Shopify. Add tracking and fulfill the correct Shopify line item. Mark Shipped in the survey admin separately; these systems do not synchronize fulfillment automatically.
7. Review upcoming 1–2 week delivery deadlines, undelivered parcels, failed emails, and incomplete surveys needing a personal follow-up. Follow the approved photo-retention policy when one is established.

## Verification

Run `node --test test/submission-alerts.test.js test/shopify-automation.test.js test/surveys.test.js test/survey-session.test.js` and the rollback-only SQL checks. The Node tests use fake email delivery and never call the live email API.

Reference: [Resend idempotency](https://resend.com/docs/dashboard/emails/idempotency-keys).
