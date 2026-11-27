-- Existing submitted row is locked briefly; all changes roll back.
-- No photos, files, submissions, or email jobs are created.
begin;
do $$
declare o public.orders%rowtype; expected text;
begin
  select * into strict o from public.orders where survey_id is not null and survey_revision is not null
    and personalization_deleted_at is null order by created_at desc limit 1 for update;
  expected:='private:survey-pdfs/surveys/'||o.survey_id::text||'/cards-'||o.survey_revision::text||'.pdf';
  update public.orders set pdf_url=expected where id=o.id;
  begin
    update public.orders set pdf_url='https://example.com/old-plain.pdf' where id=o.id;
    raise exception 'Public survey PDF accepted';
  exception when check_violation then null; end;
  begin
    update public.orders set pdf_url='private:survey-pdfs/surveys/'||o.survey_id::text||'/cards-'||(o.survey_revision+1)::text||'.pdf' where id=o.id;
    raise exception 'Wrong PDF revision accepted';
  exception when check_violation then null; end;
  begin
    update public.orders set pdf_url='private:survey-pdfs/surveys/'||gen_random_uuid()::text||'/cards-'||o.survey_revision::text||'.pdf' where id=o.id;
    raise exception 'Another survey PDF accepted';
  exception when check_violation then null; end;
  if (select pdf_url from public.orders where id=o.id) is distinct from expected then raise exception 'Rejected write changed PDF';end if;
  update public.orders set pdf_url=null where id=o.id;
  update public.orders set pdf_url=expected where id=o.id;
end $$;
select 'PASS: matching private PDF accepted; legacy public, wrong revision and wrong survey PDFs rejected; reset remains allowed' as checks;
rollback;
