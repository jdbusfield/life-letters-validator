-- Run in the Supabase SQL editor after the migration. All sample records roll back.
begin;

-- Synthetic title-photo metadata only; this entire test transaction rolls back.
create or replace function pg_temp.add_title_photo(sid uuid) returns void language plpgsql as $$
declare pid uuid:=gen_random_uuid(); path text:='surveys/'||sid::text||'/TITLE/'||gen_random_uuid()::text||'.jpg';
begin
  insert into public.survey_photos(id,survey_id,letter,storage_path,content_type) values(pid,sid,'TITLE',path,'image/jpeg');
  update public.surveys set draft=draft||jsonb_build_object('childPhoto',jsonb_build_object('storagePath',path,'position',jsonb_build_object('x',50,'y',50))) where id=sid;
end $$;

do $$
declare sid uuid:=gen_random_uuid(); sid2 uuid:=gen_random_uuid(); original_orders bigint;
  original_entries bigint; entries jsonb; result jsonb; order_id uuid;
begin
  select count(*) into original_orders from public.orders;
  select count(*) into original_entries from public.letter_entries;
  if has_table_privilege('anon','public.surveys','SELECT') or has_table_privilege('authenticated','public.surveys','SELECT') then raise exception 'Survey table must be backend-only'; end if;
  if has_function_privilege('anon','public.submit_life_letters_survey(uuid,integer,text,jsonb)','EXECUTE') then raise exception 'Anonymous RPC execution must be denied'; end if;
  if exists(select 1 from storage.buckets where id in ('survey-photos','survey-pdfs') and public) then raise exception 'Survey buckets must be private'; end if;
  if (select count(*) from pg_class where oid in ('public.surveys'::regclass,'public.survey_photos'::regclass) and relrowsecurity)<>2 then raise exception 'RLS must be enabled'; end if;
  insert into public.surveys(id,provisioning_key,customer_email,customer_name,order_reference,set_label,unit_index,access_token_hash,expires_at,draft)
  values(sid,'rollback-test:'||sid,'database-test@example.com','Test parent','ROLLBACK-TEST','Set 1',1,repeat('a',64),now()+interval '1 day','{"customerName":"Test parent","childName":"Test child","cardColor":"blue","letters":{}}'),
        (sid2,'rollback-test:'||sid2,'database-test@example.com','Test parent','ROLLBACK-TEST','Set 2',2,repeat('b',64),now()+interval '1 day','{"customerName":"Test parent","childName":"Test child","cardColor":"blue","letters":{}}');
  perform pg_temp.add_title_photo(sid);
  perform pg_temp.add_title_photo(sid2);
  select jsonb_agg(jsonb_build_object('letter',chr(i),'word','default','is_default',true,'photo_url',null,'photo_storage_path',null,'validation_status','skipped')) into entries from generate_series(65,90) i;
  begin
    perform public.submit_life_letters_survey(sid,0,repeat('b',64),entries);
    raise exception 'Wrong token was accepted';
  exception when insufficient_privilege then null; end;
  result:=public.submit_life_letters_survey(sid,0,repeat('a',64),entries);
  order_id:=(result->>'orderId')::uuid;
  if order_id is null then raise exception 'Submission did not create an order'; end if;
  result:=public.submit_life_letters_survey(sid,0,repeat('a',64),entries);
  if (result->>'alreadySubmitted')::boolean is not true then raise exception 'Duplicate submission was not idempotent'; end if;
  if (select count(*) from public.orders)<>original_orders+1 or (select count(*) from public.letter_entries)<>original_entries+26 then raise exception 'Incorrect atomic submission counts'; end if;
  perform public.reopen_life_letters_survey(sid);
  begin
    perform public.set_life_letters_order_status(order_id,'in_progress');
    raise exception 'Fulfillment started while the survey was reopened';
  exception when invalid_parameter_value then null; end;
  begin
    perform public.submit_life_letters_survey(sid,0,repeat('a',64),entries);
    raise exception 'Stale revision was accepted';
  exception when serialization_failure then null; end;
  result:=public.submit_life_letters_survey(sid,2,repeat('a',64),entries);
  if (result->>'orderId')::uuid<>order_id then raise exception 'Resubmission created a different order'; end if;
  if (select count(*) from public.letter_entries)<>original_entries+26 then raise exception 'Resubmission duplicated letter entries'; end if;
  perform public.set_life_letters_order_status(order_id,'in_progress');
  begin
    perform public.reopen_life_letters_survey(sid);
    raise exception 'Survey reopened after fulfillment started';
  exception when invalid_parameter_value then null; end;
  entries:=jsonb_set(jsonb_set(entries,'{0,is_default}','false'),'{0,photo_storage_path}','"surveys/someone-else/A.jpg"');
  begin
    perform public.submit_life_letters_survey(sid2,0,repeat('b',64),entries);
    raise exception 'An unowned photo was accepted';
  exception when invalid_parameter_value then null; end;
  if (select count(*) from public.orders)<>original_orders+1 then raise exception 'Failed submission left an order behind'; end if;
end $$;
select 'PASS: private access, atomic submission, stale revisions, repeat submissions, reopening, fulfillment locks, and photo ownership' as database_checks;
rollback;
