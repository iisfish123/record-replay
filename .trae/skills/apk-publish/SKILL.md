---
name: apk-publish
description: Push app code to GitHub, let CI build the Android APK, then publish it to the frp server for download. Use when the user asks to 上传github、打包apk、把apk放到服务器或发布新版本。
---

# APK 发布

把 `apps/app` 的改动推到 GitHub，由 CI 构建 Android APK，再把产物放到本机 API 的静态目录，供手机从公网下载。

## 前置条件

- `gh` 已登录且能访问 `iisfish123/record-replay`（`gh auth status`）
- 本机没有 Java / Android SDK，**不要尝试本地 `gradlew` 打包**，APK 一律由 CI 产出
- 本机 API 服务在运行（`pnpm dev:api`），它通过 `useStaticAssets` 把 `apps/api/storage/` 托管到 `/static`
- ChmlFrp 隧道已建立，公网地址 `http://ltw.frp.one:54802`

## 步骤

1. 查看改动，按仓库的 conventional commit 风格**分粒度**提交（后端、前端分开）：

   ```bash
   git status
   git diff --stat
   git add <具体文件> && git commit -m "<type>(<scope>): <说明>"
   ```

2. 推送分支。CI 工作流 `.github/workflows/build-apk.yml` 在 push 到 `main` 或 `feat/**` 时自动触发：

   ```bash
   git push origin <当前分支>
   ```

3. 运行发布脚本，它会自动等待 CI、下载产物、覆盖静态文件并自检：

   ```bash
   .trae/skills/apk-publish/scripts/publish-apk.sh
   ```

   也可显式指定某次 run：`.trae/skills/apk-publish/scripts/publish-apk.sh <run-id>`

4. 复核下载地址（脚本已自检）：

   ```bash
   curl -sI http://ltw.frp.one:54802/static/record-replay.apk
   ```

## 下载地址

```
http://ltw.frp.one:54802/static/record-replay.apk
```

手机浏览器直接打开即可下载安装。该地址依赖本机 API 服务与 ChmlFrp 隧道保持运行。

## 约束与排查

- APK 内的 `VITE_API_BASE_URL` 由 CI 注入，默认 `http://ltw.frp.one:54802`。要换后端地址，改仓库 Variables 的 `VITE_API_BASE_URL`，不要改本机代码
- `apps/api/storage/` 在 `.gitignore` 中，APK 不进版本库，只走静态目录发布
- `record-replay.apk` 必须放在 `apps/api/storage/` 根目录，才能映射到 `/static/record-replay.apk`
- CI 失败时看日志：`gh run view <run-id> --log-failed`。常见原因是 AndroidManifest 权限注入或 gradle 依赖
