# AI图集

Nuxt 3 + MySQL 的 AI 生成图片展示站，图片保存到 Cloudflare R2（S3 兼容接口），第三方内容通过上传 Token 接入。门户公告会由服务端使用统一登录凭据拉取，并显示在页面顶部。

## 快速启动

复制 `.env.example` 为 `.env`，填好 MySQL 和 `R2_*` 配置后：

```bash
pnpm install
docker compose up -d mysql
pnpm db:push
pnpm import:test
pnpm dev
```

默认开发地址按当前端口占用情况选择，当前项目常用 `http://127.0.0.1:3001/`。
本地开发默认启用免登录，会自动使用 `Local User` 账号并具备后台权限；生产环境默认关闭。

## 关键环境变量

- `DATABASE_URL`: MySQL 连接串。
- `LOCAL_AUTH_BYPASS`: 本地免登录开关，开发环境默认开启，生产环境默认关闭；设为 `true` 可强制开启，设为 `false` 可强制关闭。
- `IMAGE_STORAGE_DRIVER`: 图片存储驱动，默认 `r2`；只有显式设为 `local` 才会写入本地目录。
- `R2_ACCOUNT_ID` / `R2_ENDPOINT`: Cloudflare R2 账号 ID 或完整 S3 endpoint，二选一；endpoint 格式如 `https://<account-id>.r2.cloudflarestorage.com`。
- `R2_BUCKET` / `R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY`: R2 bucket 和 S3 API token。
- `R2_REGION`: R2 默认使用 `auto`。
- `R2_SIGNED_URL_TTL_SECONDS`: R2 短期访问 URL 有效期，默认 `900` 秒。
- `ZR_PORTAL_URL` / `ZR_CLIENT_ID` / `ZR_CLIENT_SECRET`: 统一登录平台配置，也用于服务端拉取门户公告；`ZR_CLIENT_SECRET` 只保留在服务端。
- `NUXT_ADMIN_ACCOUNTS` / `NUXT_ADMIN_EMAILS`: 管理员账号或邮箱，多个值用英文逗号分隔。
- `IMAGE_STORAGE_DIR`: 仅在 `IMAGE_STORAGE_DRIVER=local` 时使用。
- `UPLOAD_MAX_BYTES`: 第三方上传图片总大小限制。

## 文档

第三方上传接口文档放在 `docs/`，构建后访问 `/docs/`。文档包含上传 Token、审核状态、用户字段、参照图和展示规则。

```bash
pnpm docs:build
```

## 捐赠

如果这个项目对你有帮助，欢迎通过以下方式支持维护。

<p>
  <img src="./捐赠/微信图片_20260511124938_184_76.jpg" alt="捐赠图片 1" width="260">
  <img src="./捐赠/微信图片_20260511124939_185_76.jpg" alt="捐赠图片 2" width="260">
</p>

## 鸣谢

认可并感谢 LINUX DO 社区对开源交流与分享氛围的推动。

## Docker 部署

服务器安装 Docker 和 Docker Compose 后，复制 `.env.example` 为 `.env` 并修改 `SESSION_SECRET`、MySQL 密码、统一登录配置和管理员账号。

```bash
docker compose up -d --build
```

默认端口是 `3000`，可通过 `.env` 里的 `APP_PORT` 修改；该变量会同时控制 Nuxt 容器监听端口和宿主机映射端口。图片文件写入 Cloudflare R2，页面接口返回短期签名 URL 让浏览器直连 R2，MySQL 数据持久化到 Docker volume `mysql_data`。
