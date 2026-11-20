-- All sample data, including queued notification records, rolls back. No emails are sent.
begin;

-- Synthetic title-photo metadata only; this entire test transaction rolls back.
create or replace function pg_temp.add_title_photo(sid uuid) returns void language plpgsql as $$
declare pid uuid:=gen_random_uuid(); path text:='surveys/'||sid::text||'/TITLE/'||gen_random_uuid()::text||'.jpg';
begin
  insert into public.survey_photos(id,survey_id,letter,storage_path,content_type) values(pid,sid,'TITLE',path,'image/jpeg');
  update public.surveys set draft=draft||jsonb_build_object('childPhoto',jsonb_build_object('storagePath',path,'position',jsonb_build_object('x',50,'y',50))) where id=sid;
end $$;

do $$
declare s uuid:=gen_random_uuid(); token text:=encode(gen_random_bytes(32),'hex'); entries jsonb; result jsonb; oid uuid;
begin
  insert into public.surveys(id,provisioning_key,customer_email,customer_name,order_reference,set_label,unit_index,access_token_hash,expires_at,draft)
    values(s,'personalization-rollback:'||s,'preview@example.com','Sample Parent','ROLLBACK-PERSONALIZATION','Set 1',1,token,now()+interval '1 day','{"customerName":"Sample Parent","letters":{}}');
  perform pg_temp.add_title_photo(s);
  select jsonb_agg(jsonb_build_object('letter',chr(i),'word','default','is_default',true,'validation_status','skipped')) into entries from generate_series(65,90) i;
  begin
    perform public.submit_life_letters_survey(s,0,token,entries);
    raise exception 'Missing personalization accepted';
  exception when check_violation then null; end;
  if exists(select 1 from public.orders where survey_id=s) or (select status from public.surveys where id=s)<>'draft' then raise exception 'Failed submission was not atomic'; end if;
  update public.surveys set draft=draft||'{"childName":"Éloïse-Jane","cardColor":"purple"}'::jsonb where id=s;
  begin
    perform public.submit_life_letters_survey(s,0,token,entries);
    raise exception 'Unknown color accepted';
  exception when check_violation then null; end;
  update public.surveys set draft=jsonb_set(draft,'{cardColor}','"green"') where id=s;
  result:=public.submit_life_letters_survey(s,0,token,entries);
  oid:=(result->>'orderId')::uuid;
  if not exists(select 1 from public.orders where id=oid and child_name='Éloïse-Jane' and card_color='green') then raise exception 'Order did not snapshot exact personalization'; end if;
  result:=public.submit_life_letters_survey(s,0,token,entries);
  if (result->>'alreadySubmitted')::boolean is not true then raise exception 'Repeat submission changed'; end if;
  perform public.reopen_life_letters_survey(s);
  update public.surveys set draft=draft||'{"childName":"Leo","cardColor":"orange"}'::jsonb where id=s;
  perform public.submit_life_letters_survey(s,2,token,entries);
  if not exists(select 1 from public.orders where id=oid and child_name='Leo' and card_color='orange') then raise exception 'Resubmission did not update order personalization'; end if;
end $$;
select 'PASS: required name/color, allowed colors, atomic snapshot, exact name, duplicate submit and resubmission' as personalization_checks;
rollback;
