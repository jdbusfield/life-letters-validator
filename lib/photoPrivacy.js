export const PHOTO_PERMISSION_VERSION = "2026-11-18-v1";

export function hasPhotoPermission(survey) {
  return !!survey.photo_permission_at && survey.photo_permission_version === PHOTO_PERMISSION_VERSION;
}

export function requirePhotoPermission(survey) {
  if (!hasPhotoPermission(survey)) throw Object.assign(new Error("Please confirm the photo privacy checkbox before uploading or submitting"), { status: 422 });
}

export function requirePersonalizationAvailable(survey) {
  if (survey.personalization_purging_at || survey.personalization_deleted_at) {
    throw Object.assign(new Error("The personalization files for this set have been removed under our retention process. Contact contact@life-letters.com for help."), { status: 410 });
  }
}

export async function withPrivatePdfLease(db, order, render) {
  if (!order.survey_id) return render();
  if (!db || !Number.isInteger(order.survey_revision)) throw Error("Waiting for the customer's revised cards");
  const lease = await db.rpc("begin_life_letters_pdf", { p_order_id: order.id, p_revision: order.survey_revision });
  if (lease.error || !lease.data) throw Error("The PDF is already being prepared, or this set is no longer available for printing");
  try { return await render(); }
  finally {
    try {
      const result = await db.rpc("finish_life_letters_pdf", { p_order_id: order.id, p_token: lease.data });
      if (result.error || result.data !== true) console.error("PDF generation lock needs review", { orderId: order.id });
    } catch { console.error("PDF generation lock needs review", { orderId: order.id }); }
  }
}
