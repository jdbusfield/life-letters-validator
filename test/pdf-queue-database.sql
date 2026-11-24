-- Transactional fixtures only. No stored file bytes or emails are created.
begin;
do $$
declare sid uuid:=gen_random_uuid(); pid uuid:=gen_random_uuid(); token text:=repeat('a',64); photo text;
 entries jsonb; submitted jsonb; oid uuid; j public.pdf_jobs%rowtype; next_job public.pdf_jobs%rowtype; first_token uuid; path text;
begin
 if has_table_privilege('anon','public.pdf_jobs','SELECT') or has_function_privilege('anon','public.claim_life_letters_pdf()','EXECUTE') then raise exception 'Queue permissions are public';end if;
 -- Temporarily defer other work inside this rollback-only transaction.
 update public.pdf_jobs set retry_after=now()+interval '1 day' where state in ('queued','retry');
 insert into public.surveys(id,provisioning_key,customer_email,customer_name,order_reference,set_label,unit_index,access_token_hash,expires_at,draft,photo_permission_at,photo_permission_version,internal_test)
 values(sid,'pdf-rollback:'||sid,'pdf-test@example.invalid','Queue QA','INTERNAL-PDF-ROLLBACK','Set 1',1,token,now()+interval '1 day','{"childName":"Queue QA","cardColor":"blue","letters":{}}',now(),'2026-11-18-v1',true);
 photo:='surveys/'||sid::text||'/TITLE/'||pid::text||'.jpg';
 insert into public.survey_photos(id,survey_id,letter,storage_path,content_type)values(pid,sid,'TITLE',photo,'image/jpeg');
 update public.surveys set draft=draft||jsonb_build_object('childPhoto',jsonb_build_object('storagePath',photo,'position',jsonb_build_object('x',50,'y',50))) where id=sid;
 select jsonb_agg(jsonb_build_object('letter',chr(i),'word','default','is_default',true,'validation_status','skipped')) into entries from generate_series(65,90)i;
 submitted:=public.submit_life_letters_survey(sid,0,token,entries);oid:=(submitted->>'orderId')::uuid;
 select * into strict j from public.pdf_jobs where order_id=oid;
 if j.state<>'queued' then raise exception 'Submission did not queue atomically';end if;
 next_job:=public.queue_life_letters_pdf(oid,false);
 if next_job.id<>j.id or (select count(*) from pdf_jobs where order_id=oid)<>1 then raise exception 'Duplicate enqueue';end if;
 j:=public.claim_life_letters_pdf();
 if j.order_id<>oid or j.state<>'running' or j.attempts<>1 then raise exception 'Claim failed';end if;
 first_token:=j.claim_token;
 next_job:=public.claim_life_letters_pdf();if next_job.id is not null then raise exception 'Active job claimed twice';end if;
 if public.heartbeat_life_letters_pdf(j.id,gen_random_uuid()) then raise exception 'Wrong-token heartbeat accepted';end if;
 if not public.heartbeat_life_letters_pdf(j.id,j.claim_token) then raise exception 'Heartbeat failed';end if;
 update pdf_jobs set locked_until=now()-interval '1 second' where id=j.id;
 j:=public.claim_life_letters_pdf();
 if j.claim_token=first_token or j.attempts<>2 then raise exception 'Expired claim not recovered';end if;
 if public.finish_life_letters_pdf_job(j.id,first_token,null,'pdf_render_failed') then raise exception 'Stale worker completed';end if;
 if (select pdf_generation_token from orders where id=oid) is distinct from j.claim_token then raise exception 'Stale worker cleared current lease';end if;
 if not public.finish_life_letters_pdf_job(j.id,j.claim_token,null,'pdf_upload_failed') then raise exception 'Retry recording failed';end if;
 if not exists(select 1 from pdf_jobs where id=j.id and state='retry' and retry_after>now()) then raise exception 'No retry backoff';end if;
 update pdf_jobs set retry_after=now()-interval '1 second' where id=j.id;
 j:=public.claim_life_letters_pdf();
 path:='surveys/'||sid::text||'/cards-'||j.revision::text||'/'||j.claim_token::text||'.pdf';
 begin
   perform public.finish_life_letters_pdf_job(j.id,j.claim_token,path,null);
   raise exception 'Missing private object accepted';
 exception when check_violation then null;end;
 insert into storage.objects(bucket_id,name,metadata)values('survey-pdfs',path,'{"size":1,"mimetype":"application/pdf"}');
 if not public.finish_life_letters_pdf_job(j.id,j.claim_token,path,null) then raise exception 'Completion failed';end if;
 if not exists(select 1 from orders where id=oid and pdf_url='private:survey-pdfs/'||path and pdf_generation_token is null) then raise exception 'Wrong PDF published or lease retained';end if;
 next_job:=public.queue_life_letters_pdf(oid,false);if next_job.state<>'ready' then raise exception 'Ready PDF requeued without request';end if;
 next_job:=public.queue_life_letters_pdf(oid,true);if next_job.state<>'queued' then raise exception 'Admin retry did not queue';end if;
 j:=public.claim_life_letters_pdf();
 perform public.finish_life_letters_pdf_job(j.id,j.claim_token,null,'pdf_worker_stopping');
 if not exists(select 1 from pdf_jobs where id=j.id and state='queued' and attempts=0) then raise exception 'Shutdown used retry budget';end if;
 if exists(select 1 from survey_submission_alerts where survey_id=sid) then raise exception 'Internal load test queued an email';end if;
end $$;
select 'PASS: atomic enqueue, idempotency, exclusive claim, crash recovery, stale-worker fencing, retry backoff, private publication, admin retry, shutdown and test-email suppression' as queue_checks;
rollback;
