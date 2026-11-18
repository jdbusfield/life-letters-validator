# Card personalization

The survey starts with a required child's title-card name and one required color per purchased set. Names are preserved as entered, with a first-name suggestion and an 80-character limit. The parent/customer name remains a separate field.

The five swatches are sampled from the designer reference supplied by Corey on November 18, 2026: blue #9dc5e8, pink #e0a19d, green #cfd9c5, orange #eda86c, yellow #fae0ab. Screen swatches are guides, not print color specifications. `public/card-colors.json` supplies the backend allowlist and survey swatches.

Both values save in each private survey's draft and restore through its email link. The backend rejects submissions missing either value, including submissions from older open tabs. The additive migration `20261118_card_personalization.sql` snapshots the values into `orders.child_name` and `orders.card_color` inside the existing atomic submission transaction; resubmission refreshes them. Earlier submitted orders remain unchanged and display an earlier-set label in admin when they lack these details.

The Shopify product description shows the same five swatches and explains that the choice happens in the post-purchase survey. No new Shopify variants or checkout choices are introduced.

This release collects and stores the title-card name and color and shows them in the admin order details. The current PDF renderer still produces the existing 52 letter-card pages. The designer's final title-card and five-color templates must be integrated before these choices appear in production PDFs or printed decks. Do not print the existing plain PDF as the finished colored product.

Verification: `node --test test/card-personalization.test.js test/surveys.test.js test/survey-session.test.js test/submission-alerts.test.js test/shopify-automation.test.js`. Run `test/card-personalization-database.sql` and the saved-survey/notification rollback checks after applying the migration. Local visual preview: `node scripts/preview-card-personalization.mjs`; its memory-only sample is never a production order.
