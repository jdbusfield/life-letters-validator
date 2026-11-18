-- Rollback-only fixtures. Synthetic storage metadata below never represents a real uploaded file.
begin;
do $$
declare sid uuid:=gen_random_uuid(); sid2 uuid:=gen_random_uuid(); oid uuid; oid2 uuid;
  token text:=repeat(replace(gen_random_uuid()::text,'-',''),2); entries jsonb; answer jsonb;
  shipped timestamptz; due timestamptz; pdf_lease uuid; job public.survey_retention%rowtype;
begin
  if has_table_privilege('anon','public.survey_retention','SELECT') or has_table_privilege('authenticated','public.survey_retention_events','SELECT') or
    has_function_privilege('anon','public.claim_life_letters_retention()','EXECUTE') then raise exception 'Retention state must be private'; end if;
  -- Keep other queued work out of this transaction's worker-claim checks; this rolls back.
  update public.survey_retention set hold=true;
  insert into public.surveys(id,provisioning_key,customer_email,customer_name,order_reference,set_label,unit_index,access_token_hash,expires_at,draft,photo_permission_at,photo_permission_version)
    values(sid,'retention-rollback:'||sid,'test@example.com','Test Parent','RETENTION-ROLLBACK','Set 1',1,token,now()+interval '1 day','{"childName":"Jo","cardColor":"pink","letters":{}}',now(),'2026-11-18-v1'),
    (sid2,'retention-rollback:'||sid2,'test@example.com','Test Parent','RETENTION-ROLLBACK','Set 2',2,repeat('b',64),now()+interval '1 day','{"childName":"Leo","cardColor":"blue","letters":{}}',now(),'2026-11-18-v1');
  select jsonb_agg(jsonb_build_object('letter',chr(i),'word','default','is_default',true,'validation_status','skipped')) into entries from generate_series(65,90) i;
  answer:=public.submit_life_letters_survey(sid,0,token,entries);oid:=(answer->>'orderId')::uuid;
  answer:=public.submit_life_letters_survey(sid2,0,repeat('b',64),entries);oid2:=(answer->>'orderId')::uuid;
  if exists(select 1 from public.survey_retention where survey_id in (sid,sid2)) then raise exception 'Unshipped sets were scheduled'; end if;
  pdf_lease:=public.begin_life_letters_pdf(oid,0);
  if pdf_lease is null or public.begin_life_letters_pdf(oid,0) is not null then raise exception 'PDF lease exclusion failed'; end if;
  perform public.set_life_letters_order_status(oid,'shipped');
  select shipped_at,delete_after into shipped,due from public.survey_retention where survey_id=sid;
  if due is distinct from shipped+interval '90 days' then raise exception 'Wrong 90-day deadline'; end if;
  perform public.set_life_letters_order_status(oid,'shipped');
  if (select delete_after from public.survey_retention where survey_id=sid) is distinct from due then raise exception 'Repeat shipment reset the deadline'; end if;
  if exists(select 1 from public.claim_life_letters_retention()) then raise exception 'Premature deletion'; end if;
  update public.survey_retention set shipped_at=now()-interval '91 days',delete_after=now()-interval '1 day' where survey_id=sid;
  if not public.set_life_letters_retention_hold(sid,true,'Open order issue') then raise exception 'Hold was not recorded'; end if;
  if exists(select 1 from public.claim_life_letters_retention()) then raise exception 'Held set was claimed'; end if;
  perform public.set_life_letters_retention_hold(sid,false,null);
  if exists(select 1 from public.claim_life_letters_retention()) then raise exception 'Deletion raced a PDF generation'; end if;
  if public.finish_life_letters_pdf(oid,gen_random_uuid()) then raise exception 'Wrong PDF lease token accepted'; end if;
  perform public.finish_life_letters_pdf(oid,pdf_lease);
  insert into storage.objects(bucket_id,name) values ('survey-photos','surveys/'||sid2||'/A/unrelated-synthetic.jpg');
  -- A subtransaction rolls back synthetic metadata; never disable Storage's deletion protection.
  begin
  insert into storage.objects(bucket_id,name) values
    ('survey-photos','surveys/'||sid||'/A/synthetic.jpg'),
    ('survey-pdfs','surveys/'||sid||'/cards-old.pdf');
  insert into public.survey_photos(id,survey_id,letter,storage_path,content_type)
    values(gen_random_uuid(),sid,'A','surveys/'||sid||'/A/synthetic.jpg','image/jpeg');
  select * into job from public.claim_life_letters_retention();
  if job.survey_id is distinct from sid or jsonb_array_length(job.manifest)<>2 then raise exception 'Manifest missed old/orphan files or crossed sets'; end if;
  if public.begin_life_letters_pdf(oid,0) is not null then raise exception 'A PDF could regenerate while deleting'; end if;
  if exists(select 1 from public.claim_life_letters_retention()) then raise exception 'Double claim'; end if;
  if public.confirm_life_letters_external_cleanup(sid) then raise exception 'External cleanup confirmed too early'; end if;
  if public.finish_life_letters_retention(sid,gen_random_uuid(),null) then raise exception 'Wrong deletion token accepted'; end if;
  if public.finish_life_letters_retention(sid,job.claim_token,null) then raise exception 'Metadata erased before storage removal'; end if;
  if not exists(select 1 from public.survey_retention where survey_id=sid and error_code='files_remain') then raise exception 'Storage retry not recorded'; end if;
  update public.survey_retention set retry_after=now() where survey_id=sid;
  select * into job from public.claim_life_letters_retention();
  raise exception using errcode='P9001',message='rollback synthetic storage metadata';
  exception when sqlstate 'P9001' then null;
  end;
  -- The fixture rollback leaves an empty prefix. Actual object removal is tested through Storage API.
  select * into job from public.claim_life_letters_retention();
  if not public.finish_life_letters_retention(sid,job.claim_token,null) then raise exception 'Erasure did not finalize'; end if;
  if exists(select 1 from public.survey_photos where survey_id=sid) or exists(select 1 from public.letter_entries where order_id=oid) then raise exception 'Personalization rows remain'; end if;
  if not exists(select 1 from public.orders where id=oid and child_name is null and pdf_url is null and customer_email='test@example.com' and personalization_deleted_at is not null) then raise exception 'Order record was not preserved/minimized'; end if;
  if not exists(select 1 from public.surveys where id=sid and draft='{"letters":{}}' and personalization_deleted_at is not null and revoked_at is not null) then raise exception 'Survey content or private link was not cleared'; end if;
  if not exists(select 1 from storage.objects where name='surveys/'||sid2||'/A/unrelated-synthetic.jpg') or (select count(*) from public.letter_entries where order_id=oid2)<>26 then raise exception 'Another set was affected'; end if;
  if public.begin_life_letters_pdf(oid,0) is not null then raise exception 'Erased PDF could regenerate'; end if;
  if not public.confirm_life_letters_external_cleanup(sid) or public.confirm_life_letters_external_cleanup(sid) then raise exception 'External cleanup state is not idempotent'; end if;
  if (select count(*) from public.survey_retention_events where survey_id=sid)<5 then raise exception 'Retention audit events missing'; end if;
  perform public.record_life_letters_retention_check(null);
end $$;
select 'PASS: shipment deadline, holds, PDF exclusion, scoped manifests, retries, erasure, preserved order records, external-copy checklist, audit and access controls' as retention_checks;
rollback;
