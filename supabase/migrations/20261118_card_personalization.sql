begin;
alter table public.orders add column if not exists child_name text;
alter table public.orders add column if not exists card_color text;

create or replace function public.snapshot_life_letters_personalization()
returns trigger language plpgsql security invoker set search_path=public as $$
declare d jsonb;
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
  new.child_name := d->>'childName';
  new.card_color := d->>'cardColor';
  return new;
end $$;
revoke all on function public.snapshot_life_letters_personalization() from public,anon,authenticated;
drop trigger if exists life_letters_personalization on public.orders;
create trigger life_letters_personalization before insert or update of survey_revision on public.orders
for each row execute function public.snapshot_life_letters_personalization();
notify pgrst,'reload schema';
commit;
