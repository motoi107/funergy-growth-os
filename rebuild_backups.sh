#!/bin/bash
# rebuild_backups.sh — 各版のバックアップ(index_v<版>_backup.html)を再生成する
#
# なぜ必要か:
#   検証スクリプトは「その版が何を変えたか」を、その版の前後の差で確かめる（教訓㉕）。
#   そのため index_v901_backup.html 〜 index_v913_backup.html が必要になる。
#   14本 × 約4.9MB = 約70MB あるので zip には同梱していない。
#   ビルドスクリプトは純粋な置換なので、v900 から順に走らせれば必ず同じものが出る。
#
# 使い方:
#   ./rebuild_backups.sh
#   → 最後に index.html の md5 が v914 と一致することまで確認する
#
set -e
cd "$(dirname "$0")"

BASE="index_v900_backup.html"
[ -f "$BASE" ] || { echo "$BASE が見つかりません。前セッションの v900 が必要です。"; exit 1; }

echo "v900 から順に再生成します"
cp "$BASE" index.html
# sw.js も版を合わせる（版の一致チェックが通るように）
python3 - <<'PY'
import io, re
s = io.open('sw.js', 'r', newline='', encoding='utf-8').read()
s = re.sub(r"SW_BUILD = '\d+'", "SW_BUILD = '900'", s)
io.open('sw.js', 'w', newline='', encoding='utf-8').write(s)
PY

for v in 901 902 903 904 905 906 907 908 909 910 911 912 913 914 915 916 917 918 919 920 921 922 923 924 925 926 927 928 929 930 931 932 933 934 935 936 937 938 939 940 941 942 943 944 945 946 947 948 949 950 951 952 953 954 955 956 957 958; do
  prev=$((v-1))
  cp index.html "index_v${prev}_backup.html"
  python3 "build_v${v}.py" > /dev/null
  echo "  v${v} OK"
done
cp index.html index_v958_backup.html

echo
echo "=== 照合 ==="
md5sum index.html sw.js
echo "期待 index.html  c06f25fca5b1267813d141632acfb3c6"
echo "期待 sw.js       334ed9b0ac461917acae1d0eec74f49c"
echo
if md5sum index.html | grep -q c06f25fca5b1267813d141632acfb3c6; then
  echo "再生成に成功しました。./run_all.sh を実行できます。"
else
  echo "★md5が一致しません。ビルドスクリプトか v900 の内容を確認してください。"
  exit 1
fi
