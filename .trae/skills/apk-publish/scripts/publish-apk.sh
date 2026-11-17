#!/usr/bin/env bash
# 发布最新一次 CI 构建的 APK 到本机 API 静态目录，供公网下载。
# 用法: publish-apk.sh [run-id]
#   run-id 省略时，取 build-apk.yml 最近一次运行。
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../.." && pwd)"
WORKFLOW="build-apk.yml"
ARTIFACT="record-replay-apk"
DEST="$REPO_ROOT/apps/api/storage/record-replay.apk"
PUBLIC_URL="http://ltw.frp.one:54802/static/record-replay.apk"
LOCAL_URL="http://localhost:3000/static/record-replay.apk"

RUN_ID="${1:-}"
if [ -z "$RUN_ID" ]; then
  RUN_ID="$(gh run list --workflow="$WORKFLOW" --limit 1 --json databaseId --jq '.[0].databaseId')"
fi
[ -n "$RUN_ID" ] || { echo "未找到 $WORKFLOW 的运行记录" >&2; exit 1; }

echo "==> 等待 CI 构建完成 (run $RUN_ID)"
gh run watch "$RUN_ID" --exit-status

TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

echo "==> 下载产物 $ARTIFACT"
gh run download "$RUN_ID" -n "$ARTIFACT" -D "$TMP_DIR"

APK="$(find "$TMP_DIR" -name '*.apk' | head -1)"
[ -n "$APK" ] || { echo "产物中未找到 APK" >&2; exit 1; }

echo "==> 发布到 $DEST"
cp "$APK" "$DEST"

echo "==> 自检下载地址"
curl -sI "$LOCAL_URL" | head -3
curl -sI --max-time 20 "$PUBLIC_URL" | head -3

echo "==> 完成: $PUBLIC_URL"
