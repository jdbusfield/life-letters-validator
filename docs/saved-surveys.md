# Saved customer surveys

Each purchased set has a separate saved survey and private link. Two sets on one order require two surveys. Customers can use the original email link on another device to resume. A private link grants access to that set; treat it like a password and send it only to the intended customer.

## Current launch workflow

1. Confirm payment in Shopify before creating links.
2. Sign in at `/admin`. Under **Saved customer surveys**, enter the customer's name, email, Shopify order reference, and purchased set count.
3. Create surveys, then copy the links or prepared email text into your normal email app. This feature does not send email automatically. Links are shown once; replacing a link invalidates previous links and browser sessions.
4. Parents choose words and photos or defaults. Changes save online, with separate drafts for each set. The order reference and email remain attached to the survey.
5. Parents preview all 26 cards and click **Submit My Life Letters Cards**. The server checks custom words again, creates one production order per set, and locks customer editing. PDF generation runs afterward; the admin can retry export if needed.
6. Review submitted cards in the existing admin order dashboard. Download the PDF for the printing workflow. Mark the set in progress before starting preparation, then printed and shipped as appropriate.
7. If a parent requests a change before preparation starts, use **Reopen** in the saved survey list. The same link and order are reused. The parent must resubmit; fulfillment cannot advance while editing is open.

Automatic creation from paid Shopify orders and transactional email delivery are not connected yet. Manually entered order references are operational references, not proof of payment verified by this application.

## Configuration and deployment

- Apply `supabase/migrations/20261115_saved_surveys.sql` to the existing Supabase project before deploying this feature. It is additive and preserves historical orders and public storage buckets.
- Set `PUBLIC_BASE_URL` to the HTTPS survey origin, currently `https://life-letters-survey.onrender.com`.
- Set `REQUIRE_SURVEY_ACCESS=true` to disable legacy anonymous uploads, submissions, and customer order-status lookups. The public form remains a preview; a private link enables saving, uploading, and submission.
- Keep the existing server-only Supabase service key, OpenAI key, admin password, and session secret. No secret belongs in frontend code or GitHub.
- New photos use private `survey-photos` storage; new PDFs use private `survey-pdfs` storage. Existing legacy storage remains unchanged.

Private links expire after 180 days. Browser access cookies last at most 30 days and require a still-valid link. Replacing a link extends its expiry and invalidates old access. Expiry does not delete customer data; retention and deletion procedures must be established before launch. Unused replaced photos remain private and are not automatically deleted.

Draft writes use revision checks to prevent one device overwriting newer changes. Submission and reopening are database transactions. Submitted PDFs are versioned so older background work cannot publish over a newer revision. Service-role-only functions and row-level security prevent anonymous database access.

## Verification

Run the Node tests including `test/surveys.test.js` and `test/survey-session.test.js`. `test/saved-surveys-database.sql` exercises database constraints, submission, reopening, permissions, and fulfillment locks inside a rollback-only transaction. `scripts/preview-saved-surveys.mjs` runs a loopback-only, memory-backed sample interface without production credentials; never deploy that preview server.
