-- Run after the migration; all test rows and temporary changes roll back.
begin;
do $$
declare s uuid:=gen_random_uuid(); token text:=repeat(replace(gen_random_uuid()::text,'-',''),2);
  response jsonb; entries jsonb; job public.survey_submission_alerts%rowtype; claimed public.survey_submission_alerts%rowtype;
  original_jobs integer;
begin
  select count(*) into original_jobs from public.survey_submission_alerts;
  if not(select relrowsecurity from pg_class where oid='public.survey_submission_alerts'::regclass) then raise exception 'RLS missing'; end if;
  if has_table_privilege('anon','public.survey_submission_alerts','SELECT') or
    has_table_privilege('authenticated','public.survey_submission_alerts','SELECT') or
    has_function_privilege('anon','public.claim_life_letters_submission_alerts(text)','EXECUTE') then raise exception 'Notification queue exposed'; end if;
  insert into public.surveys(id,provisioning_key,customer_email,customer_name,order_reference,set_label,unit_index,access_token_hash,expires_at,draft)
    values(s,'alert-test:'||s,'parent@example.com','Test Parent','TEST-NOTIFICATION-ROLLBACK','Set 1',1,token,now()+interval '1 day','{"customerName":"Test Parent","letters":{}}');
  select jsonb_agg(jsonb_build_object('letter',chr(i),'word','test','is_default',true,'validation_status','valid')) into entries from generate_series(65,90) i;
  response:=public.submit_life_letters_survey(s,0,token,entries);
  if (select count(*) from public.survey_submission_alerts)<>original_jobs+1 then raise exception 'Submission did not queue exactly one alert'; end if;
  select * into job from public.survey_submission_alerts where survey_id=s;
  if job.survey_revision<>0 or job.order_reference<>'TEST-NOTIFICATION-ROLLBACK' or job.recipient_email is not null then raise exception 'Wrong alert identity'; end if;
  response:=public.submit_life_letters_survey(s,0,token,entries);
  if (select count(*) from public.survey_submission_alerts)<>original_jobs+1 then raise exception 'Duplicate submission repeated alert'; end if;
  perform public.reopen_life_letters_survey(s);
  if (select status from public.survey_submission_alerts where id=job.id)<>'cancelled' then raise exception 'Reopening left stale notification'; end if;
  response:=public.submit_life_letters_survey(s,2,token,entries);
  select * into job from public.survey_submission_alerts where survey_id=s and status='pending';
  if job.survey_revision<>2 then raise exception 'Revised submission missing'; end if;
  -- Avoid claiming any real pending notifications during this rollback-only test.
  update public.survey_submission_alerts set next_attempt_at=now()+interval '1 day' where id<>job.id;
  select * into claimed from public.claim_life_letters_submission_alerts('owner@example.com') where id=job.id;
  if claimed.status<>'sending' or claimed.attempts<>1 or claimed.recipient_email<>'owner@example.com' then raise exception 'Claim failed'; end if;
  if exists(select 1 from public.claim_life_letters_submission_alerts('owner@example.com') where id=job.id) then raise exception 'Double claimed notification'; end if;
  if public.finish_life_letters_submission_alert(job.id,gen_random_uuid(),'wrong-token',null,false) then raise exception 'Stale claim accepted'; end if;
  perform public.finish_life_letters_submission_alert(job.id,claimed.claim_token,null,'notification_http_429',false);
  update public.survey_submission_alerts set next_attempt_at=now() where id=job.id;
  select * into claimed from public.claim_life_letters_submission_alerts('changed-owner@example.com') where id=job.id;
  if claimed.recipient_email<>'owner@example.com' then raise exception 'Recipient changed during retry'; end if;
  perform public.finish_life_letters_submission_alert(job.id,claimed.claim_token,'test-provider-id',null,false);
  if (select status from public.survey_submission_alerts where id=job.id)<>'sent' then raise exception 'Success not recorded'; end if;
  update public.survey_submission_alerts set status='pending',first_attempt_at=now()-interval '21 hours',next_attempt_at=now() where id=job.id;
  perform public.claim_life_letters_submission_alerts('owner@example.com');
  if (select status from public.survey_submission_alerts where id=job.id)<>'needs_review' then raise exception 'Ambiguous old send retried'; end if;
  raise notice 'PASS: atomic queue, deduplication, reopening, resubmission, recipient freeze, leases, retries, idempotency cutoff, RLS. All test changes roll back.';
end $$;
rollback;
