# QQ Bot Sample Messages

真实 webhook/websocket payload 样本，供调试参考。

## Webhook — 回调地址验证 (OpCode 13)

服务端向配置的回调地址发送验证请求：

```json
{
  "op": 13,
  "d": {
    "plain_token": "Arq0D5A61EgUu4OxUvOp",
    "event_ts": "1725442341"
  }
}
```

应返回：

```json
{
  "plain_token": "Arq0D5A61EgUu4OxUvOp",
  "signature": "87befc99c42c651b3aac..."
}
```

## Webhook — 事件推送 (OpCode 0)

事件推送请求携带 Ed25519 签名头：

- `X-Signature-Ed25519`: 签名 hex
- `X-Signature-Timestamp`: 时间戳

### C2C 单聊消息

```json
{
  "op": 0,
  "t": "C2C_MESSAGE_CREATE",
  "id": "evt_001",
  "d": {
    "id": "msg_abc123",
    "author": {
      "user_openid": "OPENID_USER001"
    },
    "content": "你好",
    "timestamp": "1700000000",
    "attachments": []
  }
}
```

### C2C 单聊图片消息

```json
{
  "op": 0,
  "t": "C2C_MESSAGE_CREATE",
  "id": "evt_002",
  "d": {
    "id": "msg_def456",
    "author": {
      "user_openid": "OPENID_USER001"
    },
    "content": " ",
    "timestamp": "1700000001",
    "attachments": [
      {
        "content_type": "image/jpeg",
        "filename": "photo.jpg",
        "url": "https://example.com/image.jpg",
        "height": 1080,
        "width": 1920,
        "size": 256000
      }
    ]
  }
}
```

### 群聊 @机器人消息

```json
{
  "op": 0,
  "t": "GROUP_AT_MESSAGE_CREATE",
  "id": "evt_003",
  "d": {
    "id": "msg_ghi789",
    "author": {
      "member_openid": "OPENID_MEMBER001"
    },
    "content": "帮我查一下",
    "group_openid": "OPENID_GROUP001",
    "timestamp": "1700000002",
    "attachments": []
  }
}
```

### 频道 @机器人消息

```json
{
  "op": 0,
  "t": "AT_MESSAGE_CREATE",
  "id": "evt_004",
  "d": {
    "id": "msg_jkl012",
    "author": {
      "user_openid": "OPENID_USER002",
      "id": "uid_002",
      "username": "测试用户"
    },
    "content": "@bot help",
    "channel_id": "channel_001",
    "guild_id": "guild_001",
    "timestamp": "1700000003",
    "attachments": [],
    "mentions": [
      {
        "id": "bot_user_id",
        "username": "bot"
      }
    ]
  }
}
```

### 频道私信消息

```json
{
  "op": 0,
  "t": "DIRECT_MESSAGE_CREATE",
  "id": "evt_005",
  "d": {
    "id": "msg_mno345",
    "author": {
      "id": "uid_003",
      "username": "私信用户"
    },
    "content": "私聊内容",
    "channel_id": "dm_channel_001",
    "guild_id": "guild_001",
    "timestamp": "1700000004",
    "attachments": []
  }
}
```

## WebSocket — Hello 帧 (OpCode 10)

连接建立后服务端发送：

```json
{
  "op": 10,
  "d": {
    "heartbeat_interval": 41250
  }
}
```

## WebSocket — Ready 事件 (OpCode 0, t=READY)

鉴权成功后返回：

```json
{
  "op": 0,
  "t": "READY",
  "d": {
    "version": 1,
    "session_id": "session_abc",
    "user": {
      "id": "bot_id_001",
      "username": "my-bot",
      "bot": true
    },
    "shard": [0, 1]
  }
}
```
