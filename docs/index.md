# 第三方内容上传接口

本页面只说明第三方上传接口。接口用于把外部系统筛选后的 AI 生成图片提交到图库，服务端会再次校验上传 Token、提示词质量、图片类型和文件大小。

## 请求地址

```http
POST /api/uploads/third-party
Authorization: Bearer <upload-token>
Content-Type: multipart/form-data
```

`upload-token` 由图库管理员在后台 Token 页面创建、停用，并设置上传内容是否需要审核。Token 只应保存在第三方服务端，不要放到浏览器前端。

## 表单字段

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `prompt` | string | 是 | 原始提示词。中文至少 12 个汉字，英文至少 8 个有效单词；过短、占位、重复或有效内容过少会被拒绝。 |
| `images[]` | file[] | 是 | 生成结果图。至少 1 张，支持 png、jpeg、webp。 |
| `referenceImages[]` | file[] | 否 | 参照图，可传多张。会在图片详情右侧展示。 |
| `model` | string | 否 | 生成模型名称。 |
| `provider` | string | 否 | 生成服务商名称。 |
| `params` | JSON string | 否 | 生成参数，必须是可解析 JSON 字符串。 |

所有 `images[]` 的总大小不能超过服务端 `UPLOAD_MAX_BYTES` 配置，默认 30MB。

## 示例

```bash
curl -X POST "http://localhost:3001/api/uploads/third-party" \
  -H "Authorization: Bearer <upload-token>" \
  -F "prompt=一张高质量商业海报，主体清晰，光影自然，背景干净，适合产品展示" \
  -F "provider=openai" \
  -F "model=gpt-image-2" \
  -F 'params={"size":"auto","quality":"high"}' \
  -F "images[]=@./result.png" \
  -F "referenceImages[]=@./reference.png"
```

## 成功响应

```json
{
  "ok": true,
  "id": "image_set_id",
  "reviewStatus": "PENDING"
}
```

`reviewStatus` 由上传 Token 的审核策略决定。默认 Token 上传后进入 `PENDING`，管理员审核通过后才会展示在公开图库；免审 Token 上传后会直接返回 `PUBLISHED` 并展示在公开图库。

## 常见失败

| 状态码 | 原因 |
| --- | --- |
| `400` | 缺少 multipart 表单、提示词质量不足、没有上传生成图，或图片类型不支持。 |
| `401` | 缺少 Token、Token 错误或已停用。 |
| `413` | 上传图片总大小超过限制。 |

失败响应会通过 `statusMessage` 返回可读原因，第三方服务可直接记录到自己的上传日志中。
