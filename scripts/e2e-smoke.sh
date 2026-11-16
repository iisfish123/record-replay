#!/usr/bin/env bash
# 后端全链路冒烟：发码 → 登录 → 创建人格（触发音色训练）→ 等待 ready → 提问 → 轮询任务
# 用法：
#   AVATAR='<公网可访问的头像 jpg>' VOICE='<公网可访问的语音 mp3，时长 4s~300s>' ./scripts/e2e-smoke.sh
set -euo pipefail
API=${API:-http://127.0.0.1:3000}
PHONE=${PHONE:-15920328477}
AVATAR=${AVATAR:?需要 AVATAR 指向一张公网可访问的头像 jpg}
VOICE=${VOICE:?需要 VOICE 指向一段公网可访问的语音 mp3（时长 4s~300s）}

json() { python3 -c "import sys,json;print(json.load(sys.stdin)$1)"; }

echo "1) 发验证码"
curl -sf -X POST "$API/auth/sms/send" -H 'Content-Type: application/json' -d "{\"phone\":\"$PHONE\"}"
echo
read -rp "输入收到的验证码: " CODE

echo "2) 登录"
TOKEN=$(curl -sf -X POST "$API/auth/sms/login" -H 'Content-Type: application/json' \
  -d "{\"phone\":\"$PHONE\",\"code\":\"$CODE\"}" | json "['token']")
echo "token 获取成功"

echo "3) 创建人格（后台触发音色训练）"
PID=$(curl -sf -X POST "$API/personas" -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d "{\"avatarUrl\":\"$AVATAR\",\"voiceSampleUrl\":\"$VOICE\"}" | json "['id']")
echo "personaId=$PID"

echo "4) 等待音色训练完成"
for i in $(seq 1 60); do
  ST=$(curl -sf "$API/personas/$PID" -H "Authorization: Bearer $TOKEN" | json "['status']")
  echo "  status=$ST"
  [ "$ST" = "ready" ] && break
  [ "$ST" = "failed" ] && { echo "训练失败，终止"; exit 1; }
  sleep 5
done
[ "$ST" = "ready" ] || { echo "等待训练超时"; exit 1; }

echo "5) 提问"
TID=$(curl -sf -X POST "$API/personas/$PID/ask" -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' -d '{"question":"爸，你最近还好吗？"}' | json "['taskId']")
echo "taskId=$TID"

echo "6) 轮询任务"
for i in $(seq 1 120); do
  BODY=$(curl -sf "$API/tasks/$TID" -H "Authorization: Bearer $TOKEN")
  echo "  $BODY"
  echo "$BODY" | grep -q '"status":"done"' && break
  echo "$BODY" | grep -q '"status":"failed"' && { echo "任务失败，终止"; exit 1; }
  sleep 3
done
