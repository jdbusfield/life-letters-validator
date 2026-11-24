# Private PDF preparation

The web service polls the Supabase `pdf_jobs` table every five seconds and renders one deck at a time in a child process. This uses the existing Render instance and Supabase project; there is no separate queue subscription.

Apply `supabase/migrations/20261124_pdf_queue.sql` before deploying the worker. The order transaction enqueues the submitted revision atomically. The unique order/revision key prevents duplicate jobs. A fresh claim token fences each attempt, heartbeats extend its fifteen-minute lease, and publication requires both that token and the current order revision. Files are written to an attempt-specific private path. Superseded workers cannot overwrite current files.

Rendering has a three-minute child-process limit and a five-minute overall job deadline. Failures retry after 30, 60, and 120 seconds, then require admin attention after four attempts. Graceful shutdown returns the active job to the queue without consuming an attempt. An abrupt termination is recovered after lease expiry. Unknown earlier-system order leases are deliberately not cleared automatically.

Admin → PDF preparation shows queued, preparing, retry, ready, and failed jobs. Download/Export retrieves a prepared PDF; it no longer regenerates a private deck during a download request. Regenerate explicitly queues another attempt. Existing prepared PDFs remain available until replacement succeeds.

Run `node --test test/*.test.js` for application regression checks. `test/pdf-queue-database.sql` exercises claims, crash recovery, fencing, retry, publication and shutdown within a rolled-back transaction. Use a controlled maintenance window for database tests because they acquire locks briefly.

`scripts/test-live-pdf-queue.mjs` provisions fixtures locally, prepares ten synthetic saved surveys through the public survey API, and submits them simultaneously. Insert its generated SQL fixtures through an authorized database session before running prepare/submit. Fixtures are explicitly internal tests and suppress submission email alerts; no Shopify orders or printing purchases are made. Keep token fixtures private. Synthetic records are retained with INTERNAL-PDF-LOADTEST references for inspection and should not be fulfilled.

The live test checks ten concurrent submissions, not one hundred simultaneous full-resolution customer uploads. Monitor queue age, retry failures, memory and storage after launch. Only the blue final designer artwork is currently integrated.
