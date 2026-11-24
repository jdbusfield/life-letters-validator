// The earlier successful decks use cards-N.pdf. Queue attempts use unique
// paths so a stale worker cannot overwrite the winning revision's bytes.
export function privatePdfPath(order) {
  if(!order.survey_id || !Number.isInteger(order.survey_revision))throw Error('PDF is not ready');
  const prefix=`private:survey-pdfs/surveys/${order.survey_id}/cards-${order.survey_revision}`;
  const value=order.pdf_url;
  if(typeof value!=='string' || !(value===`${prefix}.pdf` ||
    (value.startsWith(`${prefix}/`) && /^[a-f0-9-]{36}\.pdf$/.test(value.slice(prefix.length+1)))))throw Error('PDF is not ready');
  return value.slice('private:survey-pdfs/'.length);
}
