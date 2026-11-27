-- Add required private title photos; preserve all previously submitted orders and their files.
begin;
alter table public.survey_photos drop constraint if exists survey_photos_letter_check;
alter table public.survey_photos add constraint survey_photos_letter_check check (letter ~ '^[A-Z]$' or letter='TITLE');
alter table public.orders add column if not exists child_photo_storage_path text;
alter table public.orders add column if not exists child_photo_url text;
alter table public.orders add column if not exists child_photo_position jsonb;
create or replace function public.snapshot_life_letters_personalization()
returns trigger language plpgsql security invoker set search_path=public as $$
declare d jsonb; photo public.survey_photos%rowtype; pos jsonb;
begin
  if new.survey_id is null or new.survey_revision is null then return new; end if;
  if tg_op='UPDATE' then
    if new.survey_revision is not distinct from old.survey_revision then return new; end if;
  end if;
  select draft into d from public.surveys where id=new.survey_id;
  if jsonb_typeof(d->'childName') is distinct from 'string'
    or length(btrim(coalesce(d->>'childName',''))) = 0
    or length(d->>'childName') > 80
    or (d->>'childName') ~ '[[:cntrl:]]'
    or coalesce(d->>'cardColor','') not in ('blue','pink','green','orange','yellow') then
    raise exception 'card_personalization_required' using errcode='23514';
  end if;
  if jsonb_typeof(d#>'{childPhoto,storagePath}') is distinct from 'string' then
    raise exception 'child_photo_required' using errcode='23514';
  end if;
  select * into photo from public.survey_photos where survey_id=new.survey_id and letter='TITLE' and storage_path=d#>>'{childPhoto,storagePath}';
  if not found or not starts_with(photo.storage_path,'surveys/'||new.survey_id::text||'/TITLE/') then
    raise exception 'child_photo_owner_invalid' using errcode='23514';
  end if;
  pos:=coalesce(d#>'{childPhoto,position}','{"x":50,"y":50}'::jsonb);
  if jsonb_typeof(pos->'x') is distinct from 'number' or jsonb_typeof(pos->'y') is distinct from 'number' then raise exception 'child_photo_position_invalid' using errcode='23514'; end if;
  if (pos->>'x')::numeric not between 0 and 100 or (pos->>'y')::numeric not between 0 and 100 then raise exception 'child_photo_position_invalid' using errcode='23514'; end if;
  new.child_photo_storage_path:=photo.storage_path;
  new.child_photo_url:='/api/surveys/'||new.survey_id::text||'/photos/'||photo.id::text;
  new.child_photo_position:=pos;
  new.child_name := d->>'childName';
  new.card_color := d->>'cardColor';
  return new;
end $$;

create or replace function public.finish_life_letters_retention(p_survey_id uuid,p_claim_token uuid,p_error text default null)
returns boolean language plpgsql security invoker set search_path=public as $$
declare s public.surveys%rowtype; o public.orders%rowtype; j public.survey_retention%rowtype;
begin
  select * into s from public.surveys where id=p_survey_id for update;
  if not found then return false; end if;
  select * into o from public.orders where id=s.submitted_order_id for update;
  select * into j from public.survey_retention where survey_id=s.id for update;
  if not found or p_claim_token is null then return false; end if;
  if j.claim_token is distinct from p_claim_token or j.state<>'deleting' or j.locked_until is null or j.locked_until<now() then return false; end if;
  if p_error is null and exists(select 1 from storage.objects where bucket_id in ('survey-photos','survey-pdfs') and starts_with(name,'surveys/'||s.id::text||'/')) then p_error:='files_remain'; end if;
  if p_error is not null then
    update public.survey_retention set error_code=left(p_error,80),claim_token=null,locked_until=null,retry_after=now()+interval '1 hour' where survey_id=s.id;
    insert into public.survey_retention_events(survey_id,event) values(s.id,'deletion_retry_required');
    return false;
  end if;
  delete from public.letter_entries where order_id=o.id;
  delete from public.survey_photos where survey_id=s.id;
  update public.orders set child_name=null,card_color=null,child_photo_storage_path=null,child_photo_url=null,child_photo_position=null,pdf_url=null,personalization_deleted_at=now(),updated_at=now() where id=o.id;
  update public.surveys set draft='{"letters":{}}',customer_name='',set_label='Set '||unit_index::text,
    personalization_deleted_at=now(),revoked_at=now(),revision=revision+1,updated_at=now() where id=s.id;
  update public.survey_submission_alerts set set_label='Set '||s.unit_index::text where survey_id=s.id;
  update public.survey_retention set state='app_deleted',app_deleted_at=now(),manifest='[]',error_code=null,claim_token=null,locked_until=null where survey_id=s.id;
  insert into public.survey_retention_events(survey_id,event) values(s.id,'active_survey_files_deleted');
  return true;
end $$;


revoke all on function public.snapshot_life_letters_personalization(),public.finish_life_letters_retention(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.snapshot_life_letters_personalization(),public.finish_life_letters_retention(uuid,uuid,text) to service_role;
notify pgrst,'reload schema';
commit;
