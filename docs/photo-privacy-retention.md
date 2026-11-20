# Photo privacy and retention rollout

Approved business rule: remove personalization files 90 days after the finished cards ship to the customer. The short survey notice and adult/permission acknowledgement are separate from the full website policy, which remains an unpublished draft.

## What the survey enforces

The checkbox is required before photo uploads and new submissions. The server records its version and acceptance time with each private survey; it does not trust a browser-supplied acceptance timestamp. An outdated notice version requires a reload and new acknowledgement. An existing submitted set can still be read without retroactively manufacturing consent. Parents may clear the checkbox, which blocks further uploads and submission; contact support for deletion of previously supplied files.

The notice describes private survey storage, the 90-day shipment schedule, order/legal holds, printing through Canva, and the separate handling of working copies and backups. It does not link to or claim that the full photo policy is published. Do not publish the full draft until provider/backup limits and the older-system files have been reviewed.

## Shipment and deletion

1. Mark Shipped in the survey admin only when the finished set actually ships to the customer. This records a first shipment timestamp and atomically schedules deletion 90 days later. Repeating the status does not reset that date. This status is still separate from Shopify fulfillment; record tracking and fulfillment there too.
2. The existing paid web service polls every five minutes when `SURVEY_RETENTION_ENABLED=true`. No additional Render service or subscription is provisioned. A database queue and per-set leases make pending work survive deploys and allow safe retries. A service outage delays cleanup until it recovers; the admin panel shows the last check.
3. A due set must still be Shipped and must not have a retention hold or an active PDF-generation lock. Once deletion starts, private survey/photo access and PDF regeneration are blocked. PDF generation acquires a database lock that prevents erasure racing an upload. A lock left by an interrupted process never silently expires into deletion; investigate it before clearing it.
4. The worker enumerates every object under the exact `surveys/{survey_id}/` prefix in `survey-photos` and `survey-pdfs`, including unused uploads and older PDF revisions. It deletes only those objects through the Supabase Storage API. It never directly deletes storage metadata to simulate object deletion.
5. The database verifies that the storage prefix is empty before clearing the draft, child name, color, letter entries, photo metadata, stored PDF link, personalized set labels and private-link access. Basic order/contact/shipment records remain. Minimal, private event records track deletion and exceptions without retaining photo contents or custom words.
6. Staff then remove or verify the absence of Canva uploads/designs, downloaded PDFs and other company working copies, and managed trash/recycle-bin copies. Confirm all three in the admin panel. This records a managed-copy check; it is not certification that providers' internal backups have been erased.

## Operator review

- Add an order-issue hold before deletion starts when the files remain necessary for an unresolved problem. Release it when that need ends. Releasing an overdue hold makes the set immediately eligible; its deadline is not reset.
- Missing shipment dates are never inferred from order creation dates. Older shipped orders need their real shipment dates reviewed before scheduling. Do not toggle Shipped just to manufacture a date for an old order.
- Inactive unfinished surveys are counted for review after 90 days without activity, not automatically deleted or cancelled. The reminder and paid-order resolution workflow is not implemented in this release.
- Earlier-system `letter-photos` / `order-pdfs` files and orders without a private survey are counted separately. They are not bulk-deleted by this worker because they lack reliable per-set shipment dates and storage ownership mapping.
- Verify a customer deletion request against the order and explain any impact on production/replacements. This release does not add a customer-triggered immediate-deletion endpoint or automatic cancellation/refund handling.
- An interrupted PDF lock appears in the admin panel. Confirm no generation is still running before clearing `orders.pdf_generation_token` and `pdf_generation_started_at` for that specific order through a reviewed maintenance operation. Do not clear all locks.

## Deployment and checks

Apply `supabase/migrations/20261118_photo_retention.sql` before deploying. Run `test/photo-retention-database.sql`, which rolls back all synthetic test rows. Then deploy and enable the non-secret `SURVEY_RETENTION_ENABLED=true` variable. Review the overview before enabling: no production set should be dated or deleted just to test this feature.

Run `node --test test/photo-retention.test.js test/card-personalization.test.js test/surveys.test.js test/survey-session.test.js test/submission-alerts.test.js test/shopify-automation.test.js`.

Verify a controlled synthetic set through consent, upload, shipment scheduling, due-date eligibility, Storage API erasure, and private-link/PDF denial. Keep that set clearly marked TEST and separate from the user's existing test draft. Also check the admin endpoint rejects unauthenticated reads and writes.

Backups, archived emails, customer-owned browser/device copies, and copies retained independently by service providers are outside this worker. Their applicable retention and deletion practices must be established before the full policy makes broader claims. The customer notice's automated deletion scope is active survey storage.
