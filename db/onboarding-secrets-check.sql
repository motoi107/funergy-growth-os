-- 読むだけ（v1128）：新しく入った人の記録（app_state の onboardings・spl_onboardings_<名前>）に、
-- 機密（住所・電話・メール・生年月日・SSN・ビザ・書類の画像）が残っている数を数える。値は出さない。
-- 1 行の結果：rows（行の数）・records（人の数）・with_secret（機密の欄に値がある人）・with_doc_image（書類の画像がある人）
with r as (
  select key, value from app_state
  where key = 'onboardings' or key like 'spl\_onboardings\_%' escape '\'
), e as (
  select r.key, x as rec
  from r, jsonb_array_elements(case when jsonb_typeof(r.value) = 'array' then r.value else '[]'::jsonb end) x
)
select
  (select count(*) from r) as rows,
  count(*) as records,
  count(*) filter (where exists (
    select 1 from unnest(array['address','phone','email','dob','ssn','visa','visaDetail']) f
    where coalesce(rec->'personal'->>f, '') <> '')) as with_secret,
  count(*) filter (where exists (
    select 1 from jsonb_array_elements(case when jsonb_typeof(rec->'docs') = 'array' then rec->'docs' else '[]'::jsonb end) d
    where coalesce(d->>'image', '') <> '')) as with_doc_image
from e;
