-- Synthetic fixtures only. Everything rolls back; no files or emails are created.
begin;
do $$
declare s uuid:=gen_random_uuid(); other_s uuid:=gen_random_uuid(); token text:=encode(gen_random_bytes(32),'hex'); entries jsonb; result jsonb; oid uuid; photo_id uuid:=gen_random_uuid(); photo_path text;
begin
  insert into public.surveys(id,provisioning_key,customer_email,customer_name,order_reference,set_label,unit_index,access_token_hash,expires_at,draft)
  values(s,'title-rollback:'||s,'preview@example.com','Sample Parent','ROLLBACK-TITLE','Set 1',1,token,now()+interval '1 day','{"childName":"Alexandria-Josephine","cardColor":"blue","letters":{}}'),
  (other_s,'title-rollback:'||other_s,'preview@example.com','Sample Parent','ROLLBACK-TITLE-OTHER','Set 1',1,encode(gen_random_bytes(32),'hex'),now()+interval '1 day','{"letters":{}}');
  select jsonb_agg(jsonb_build_object('letter',chr(i),'word','default','is_default',true,'validation_status','skipped')) into entries from generate_series(65,90) i;
  begin perform public.submit_life_letters_survey(s,0,token,entries);raise exception 'Missing title photo accepted';exception when check_violation then null;end;
  if exists(select 1 from public.orders where survey_id=s) then raise exception 'Failed submission created order';end if;
  photo_path:='surveys/'||other_s::text||'/TITLE/fake.jpg';
  insert into public.survey_photos(id,survey_id,letter,storage_path,content_type) values(photo_id,other_s,'TITLE',photo_path,'image/jpeg');
  update public.surveys set draft=draft||jsonb_build_object('childPhoto',jsonb_build_object('storagePath',photo_path,'position',jsonb_build_object('x',50,'y',50))) where id=s;
  begin perform public.submit_life_letters_survey(s,0,token,entries);raise exception 'Other customer title photo accepted';exception when check_violation then null;end;
  photo_path:='surveys/'||s::text||'/TITLE/fake.jpg';
  update public.survey_photos set survey_id=s,storage_path=photo_path where id=photo_id;
  update public.surveys set draft=draft||jsonb_build_object('childPhoto',jsonb_build_object('storagePath',photo_path,'position',jsonb_build_object('x',101,'y',50))) where id=s;
  begin perform public.submit_life_letters_survey(s,0,token,entries);raise exception 'Invalid position accepted';exception when check_violation then null;end;
  update public.surveys set draft=jsonb_set(draft,'{childPhoto,position}','{"x":20,"y":75}') where id=s;
  result:=public.submit_life_letters_survey(s,0,token,entries);oid:=(result->>'orderId')::uuid;
  if not exists(select 1 from public.orders where id=oid and child_name='Alexandria-Josephine' and child_photo_storage_path=photo_path and child_photo_position='{"x":20,"y":75}'::jsonb and child_photo_url='/api/surveys/'||s::text||'/photos/'||photo_id::text) then raise exception 'Title snapshot mismatch';end if;
  perform public.reopen_life_letters_survey(s);
  update public.surveys set draft=jsonb_set(draft,'{childPhoto,position}','{"x":80,"y":25}') where id=s;
  perform public.submit_life_letters_survey(s,2,token,entries);
  if not exists(select 1 from public.orders where id=oid and child_photo_position='{"x":80,"y":25}'::jsonb) then raise exception 'Resubmission did not update title framing';end if;
end $$;
select 'PASS: title photo required, ownership protected, framing validated, atomic snapshot and resubmission' as title_checks;
rollback;
