// This module is only installed on the retired master-branch application.
export const CURRENT_SURVEY_ADMIN = "https://life-letters-survey.onrender.com/admin";
export function retiredExporterError() {
  return Object.assign(new Error("This exporter has been retired. Use "+CURRENT_SURVEY_ADMIN),{status:410,code:"legacy_exporter_retired"});
}
export function legacyExporterRetirement(req,res,next) {
  if(req.method==="GET" && req.path==="/api/admin/export-status")
    return res.set("Cache-Control","no-store").json({retired:true,exporter:"legacy",currentAdmin:CURRENT_SURVEY_ADMIN});
  if(req.method==="GET" && ["/admin","/admin.html"].includes(req.path))
    return res.redirect(302,CURRENT_SURVEY_ADMIN);
  if(/^\/api\/admin\/(?:export(?:\/|$)|orders\/[^/]+\/(?:regenerate-pdf|pdf)(?:\/|$))/.test(req.path))
    return res.status(410).set("Cache-Control","no-store").json({error:"This exporter has been retired.",currentAdmin:CURRENT_SURVEY_ADMIN});
  next();
}
