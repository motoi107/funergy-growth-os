-- 読むだけ（何も書き換えない）。tip_labor の列の決まりと主キー（v1090 の調整額の保存の確かめ・Codex 9752ac3）
-- 結果の 2 つの表を Claude に貼ってください。
select column_name, data_type, is_nullable, column_default
from information_schema.columns
where table_schema = 'public' and table_name = 'tip_labor'
order by ordinal_position;

select tc.constraint_type, tc.constraint_name, string_agg(kcu.column_name, ', ' order by kcu.ordinal_position) as columns
from information_schema.table_constraints tc
join information_schema.key_column_usage kcu
  on kcu.constraint_schema = tc.constraint_schema and kcu.constraint_name = tc.constraint_name
where tc.table_schema = 'public' and tc.table_name = 'tip_labor' and tc.constraint_type in ('PRIMARY KEY', 'UNIQUE')
group by tc.constraint_type, tc.constraint_name
order by 1, 2;
