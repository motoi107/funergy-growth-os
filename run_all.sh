#!/bin/bash
# run_all.sh — 検証を全部走らせる。配布前に必ずこれ。
# 事前に一度だけ: npm install acorn jsdom typescript xlsx
#   v936: xlsx が抜けていた。無いと verify_v910/918/920/922/923/924 が
#   『PLブックが無いので ⏭』ではなく MODULE_NOT_FOUND で ★FAIL になる。
cd "$(dirname "$0")"
fail=0
echo "=== 構文チェック ==="
node -e "
const fs=require('fs'); const s=fs.readFileSync('index.html','utf8');
const i=s.indexOf('<script>'), j=s.lastIndexOf('</script>');
const body=s.slice(i+8,j);
try{ new Function(body); }
catch(e){
  // v912: new Function は位置を教えてくれない。acorn なら行と前後が出る。
  console.log('  SYNTAX FAIL: '+e.message);
  try{ require('acorn').parse(body,{ecmaVersion:2020}); }
  catch(e2){
    console.log('  → '+e2.message);
    console.log('  → 前後: '+JSON.stringify(body.slice(Math.max(0,e2.pos-200), e2.pos+80)));
  }
  process.exit(1);
}
console.log('  SYNTAX OK');
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

echo "=== 同名関数の重複（v921）==="
if out=$(node scan_dupfn.js index.html 2>&1); then
  echo "  重複なし"

echo "=== 検証スクリプトの書き方（vlib・v941）==="
node scan_verify_style.js || FAILED="$FAILED scan_verify_style"
else
  echo "$out" | sed 's/^/  /'
  fail=1
fi

echo "=== 検証 ==="
# v915: 「ファイルが無い（欠落）」と「有るが落ちた（FAIL）」を分ける。
#   従来はどちらも FAIL と出ていたため、本物の失敗が欠落13本に埋もれていた。
#   欠落は配布を止めない。止めるのは本物の FAIL だけ。
missing=""
nmiss=0
for f in verify_v896 verify_v901 verify_v902 verify_v903 verify_v904 verify_v905 verify_v906 verify_v907 verify_v908 verify_v909 verify_v910 verify_v911 verify_v912 verify_v913 verify_v914 verify_v915 verify_v916 verify_v917 verify_v918 verify_v919 verify_v920 verify_v921 verify_v922 verify_v923 verify_v924 verify_v925 verify_v926 verify_v927 verify_v928 verify_v929 verify_v930 verify_v931 verify_v932 verify_v933 verify_v934 verify_v935 verify_v936 verify_v937 verify_v938 verify_vlib verify_v939 verify_v940 verify_v941 verify_v942 verify_v943 verify_v944 verify_v945 verify_v946 verify_v947 verify_v948 verify_v949 verify_v950 verify_v951 verify_v952 verify_v953 verify_v954 verify_v955 verify_v956 verify_v957 smoke_v900 verify_v886 verify_v887 verify_v888 verify_v891 \
         smoke_v886 smoke_v887 smoke_v889 smoke_v890 smoke_v892 smoke_v893 \
         smoke_v894 smoke_v894_rows smoke_v895; do
  printf "  %-18s " "$f"
  if [ ! -f "$f.js" ]; then
    echo "— 欠落（ファイルが無い）"
    missing="$missing $f"
    nmiss=$((nmiss+1))
    continue
  fi
  if out=$(node "$f.js" 2>/dev/null); then echo "$(echo "$out" | tail -1)"
  else echo "★FAIL（このファイルは有る）"; echo "$out" | grep -E '❌|^  FAIL' | head -5; fail=1; fi
done

echo
if [ $nmiss -gt 0 ]; then
  echo "欠落 $nmiss 本（テスト失敗ではなくファイル不在）:$missing"
  echo "  → 手元に残っていれば同梱してください。無ければ作り直しが必要です。"
  echo
fi
[ $fail -eq 0 ] && echo "本物のFAILは無し。配布してよい。" || echo "★本物のFAILがある。配布しないこと。"
exit $fail
