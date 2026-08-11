#!/bin/bash
# run_all.sh — 検証を全部走らせる。配布前に必ずこれ。
# 事前に一度だけ: npm install acorn jsdom
cd "$(dirname "$0")"
fail=0
echo "=== 構文チェック ==="
node -e "
const fs=require('fs'); const s=fs.readFileSync('index.html','utf8');
const i=s.indexOf('<script>'), j=s.lastIndexOf('</script>');
try{ new Function(s.slice(i+8,j)); console.log('  SYNTAX OK'); }
catch(e){ console.log('  SYNTAX FAIL: '+e.message); process.exit(1); }
" || fail=1

echo "=== バイト衛生 ==="
python3 -c "
d=open('index.html','rb').read()
lone=d.count(b'\n')-d.count(b'\r\n')
print('  CRLF %d / lone LF %d'%(d.count(b'\r\n'), lone))
raise SystemExit(1 if lone else 0)
" || fail=1

echo "=== 版の一致 ==="
a=$(grep -o "APP_VERSION = '[0-9]*'" index.html | grep -o '[0-9]*')
b=$(grep -o "SW_BUILD = '[0-9]*'" sw.js | grep -o '[0-9]*')
if [ "$a" = "$b" ]; then echo "  APP_VERSION=$a SW_BUILD=$b  OK"; else echo "  不一致 APP=$a SW=$b"; fail=1; fi

echo "=== Edge Function（TypeScript）==="
if [ -f discount-log.index.ts ]; then
  if [ -x ./node_modules/.bin/tsc ]; then
    if ./node_modules/.bin/tsc --noEmit --strict --target es2022 --lib es2022,dom \
         --moduleResolution bundler --module esnext deno.d.ts discount-log.index.ts; then
      echo "  discount-log  OK"
    else
      echo "  discount-log  型エラー（デプロイすると起動せず Failed to fetch になる）"; fail=1
    fi
  else
    echo "  tsc が無い（npm install typescript）"; fail=1
  fi
fi

echo "=== フォーム定数の突き合わせ ==="
if [ -f discount_survey.gs ]; then
  if node check_form_sync.js > /dev/null 2>&1; then echo "  アプリ ⇔ Apps Script  一致"
  else echo "  アプリ ⇔ Apps Script  ずれている（node check_form_sync.js で詳細）"; fail=1; fi
fi

echo "=== 検証 ==="
for f in verify_v896 verify_v901 verify_v902 verify_v903 verify_v904 verify_v905 verify_v906 verify_v907 verify_v908 verify_v909 verify_v910 smoke_v900 verify_v886 verify_v887 verify_v888 verify_v891 \
         smoke_v886 smoke_v887 smoke_v889 smoke_v890 smoke_v892 smoke_v893 \
         smoke_v894 smoke_v894_rows smoke_v895; do
  printf "  %-18s " "$f"
  if out=$(node "$f.js" 2>/dev/null); then echo "$(echo "$out" | tail -1)"
  else echo "FAIL"; echo "$out" | grep -E '^  FAIL' | head -5; fail=1; fi
done

echo
[ $fail -eq 0 ] && echo "すべて緑。配布してよい。" || echo "落ちている。配布しないこと。"
exit $fail
