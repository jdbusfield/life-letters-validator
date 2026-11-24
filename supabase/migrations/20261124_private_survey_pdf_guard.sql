-- An earlier exporter still writes public PDFs into this shared database.
-- Saved survey sets must only point at their own current private revision.
begin;
create or replace function public.guard_life_letters_survey_pdf()
returns trigger language plpgsql set search_path=public as $$
begin
  if new.survey_id is not null and new.pdf_url is not null then
    if new.survey_revision is null or new.pdf_url is distinct from
      'private:survey-pdfs/surveys/'||new.survey_id::text||'/cards-'||new.survey_revision::text||'.pdf' then
      raise exception 'Saved surveys require their current private card PDF; use the Life Letters survey admin.' using errcode='23514';
    end if;
  end if;
  return new;
end $$;
drop trigger if exists life_letters_private_survey_pdf on public.orders;
create trigger life_letters_private_survey_pdf before insert or update of pdf_url,survey_id,survey_revision
on public.orders for each row execute function public.guard_life_letters_survey_pdf();
commit;
