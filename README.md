# AI图集

Nuxt 3 + MySQL 的 AI 生成图片展示站，图片保存在本地 `storage/images`，第三方内容通过上传 Token 接入。

## 快速启动

```bash
pnpm install
docker compose up -d mysql
pnpm db:push
pnpm import:test
pnpm dev
```

默认开发地址按当前端口占用情况选择，当前项目常用 `http://127.0.0.1:3001/`。

## 关键环境变量

- `DATABASE_URL`: MySQL 连接串。
- `ZR_PORTAL_URL` / `ZR_CLIENT_ID` / `ZR_CLIENT_SECRET`: 统一登录平台配置。
- `NUXT_ADMIN_ACCOUNTS` / `NUXT_ADMIN_EMAILS`: 管理员账号或邮箱，多个值用英文逗号分隔。
- `IMAGE_STORAGE_DIR`: 本地图片保存目录。
- `UPLOAD_MAX_BYTES`: 第三方上传图片总大小限制。

## 文档

第三方上传接口文档放在 `docs/`，构建后访问 `/docs/`。

```bash
pnpm docs:build
```

## Docker 部署

服务器安装 Docker 和 Docker Compose 后，复制 `.env.example` 为 `.env` 并修改 `SESSION_SECRET`、MySQL 密码、统一登录配置和管理员账号。

```bash
docker compose up -d --build
```

默认端口是 `3000`，可通过 `.env` 里的 `APP_PORT` 修改；该变量会同时控制 Nuxt 容器监听端口和宿主机映射端口。图片文件持久化到宿主机 `./storage/images`，MySQL 数据持久化到 Docker volume `mysql_data`。
