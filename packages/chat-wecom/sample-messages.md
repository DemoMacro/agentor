# 企业微信 Sample Messages

真实 webhook/callback payload 样本，供调试参考。

## Bot 回调模式 — 加密外层

POST 请求携带加密的 JSON body，URL query 含签名参数：

```
GET/POST /webhook?msg_signature=xxx&timestamp=1234&nonce=abc&echostr=optional
```

```json
{
  "encrypt": "base64-encoded-encrypted-content"
}
```

## Bot 回调模式 — 解密后文本消息

```json
{
  "msgid": "msg_123456",
  "aibotid": "bot_abc",
  "chatid": "chat_001",
  "chattype": "group",
  "from": {
    "userid": "user001",
    "corpid": "corp123"
  },
  "response_url": "https://qyapi.weixin.qq.com/cgi-bin/aibot/response?response_code=xxx",
  "create_time": 1700000000,
  "msgtype": "text",
  "text": {
    "content": "你好"
  }
}
```

## Bot 回调模式 — 图片消息 (仅单聊)

```json
{
  "msgid": "msg_234567",
  "aibotid": "bot_abc",
  "chattype": "single",
  "from": {
    "userid": "user002"
  },
  "response_url": "https://qyapi.weixin.qq.com/cgi-bin/aibot/response?response_code=xxx",
  "create_time": 1700000001,
  "msgtype": "image",
  "image": {
    "url": "https://example.com/image.enc"
  }
}
```

> 回调模式中图片/文件/视频/语音的 URL 已加密，解密 AESKey 即为配置的 EncodingAESKey。

## Bot 回调模式 — 语音消息 (仅单聊)

语音消息不提供音频文件 URL，仅返回语音转文本内容。

```json
{
  "msgid": "msg_voice_001",
  "aibotid": "bot_abc",
  "chattype": "single",
  "from": {
    "userid": "user_voice"
  },
  "response_url": "https://qyapi.weixin.qq.com/cgi-bin/aibot/response?response_code=xxx",
  "create_time": 1700000003,
  "msgtype": "voice",
  "voice": {
    "content": "语音转文本的内容"
  }
}
```

## Bot 回调模式 — 文件消息 (仅单聊)

```json
{
  "msgid": "msg_file_001",
  "aibotid": "bot_abc",
  "chattype": "single",
  "from": {
    "userid": "user_file"
  },
  "response_url": "https://qyapi.weixin.qq.com/cgi-bin/aibot/response?response_code=xxx",
  "create_time": 1700000004,
  "msgtype": "file",
  "file": {
    "url": "https://example.com/file.enc"
  }
}
```

## Bot 回调模式 — 视频消息 (仅单聊)

```json
{
  "msgid": "msg_video_001",
  "aibotid": "bot_abc",
  "chattype": "single",
  "from": {
    "userid": "user_video"
  },
  "response_url": "https://qyapi.weixin.qq.com/cgi-bin/aibot/response?response_code=xxx",
  "create_time": 1700000005,
  "msgtype": "video",
  "video": {
    "url": "https://example.com/video.enc"
  }
}
```

## Bot 回调模式 — 混合消息

```json
{
  "msgid": "msg_345678",
  "aibotid": "bot_abc",
  "chatid": "chat_001",
  "chattype": "group",
  "from": {
    "userid": "user003"
  },
  "response_url": "https://qyapi.weixin.qq.com/cgi-bin/aibot/response?response_code=xxx",
  "create_time": 1700000002,
  "msgtype": "mixed",
  "mixed": {
    "msg_item": [
      {
        "msgtype": "text",
        "text": {
          "content": "描述文字"
        }
      },
      {
        "msgtype": "image",
        "image": {
          "url": "https://example.com/mixed-image.enc"
        }
      }
    ]
  }
}
```

## Bot WebSocket 模式 — 文本消息帧

```json
{
  "cmd": "aibot_msg_callback",
  "headers": {
    "req_id": "req_001"
  },
  "body": {
    "msgid": "msg_456789",
    "aibotid": "bot_abc",
    "chatid": "chat_002",
    "chattype": "single",
    "from": {
      "userid": "user004"
    },
    "create_time": 1700000003,
    "msgtype": "text",
    "text": {
      "content": "@bot 帮我查一下"
    }
  }
}
```

## App 回调 — 文本消息 (解密后 XML)

```xml
<xml>
  <ToUserName><![CDATA[corpAgent]]></ToUserName>
  <FromUserName><![CDATA[user001]]></FromUserName>
  <CreateTime>1700000000</CreateTime>
  <MsgType><![CDATA[text]]></MsgType>
  <Content><![CDATA[Hello]]></Content>
  <MsgId>1234567890</MsgId>
  <AgentID>1000001</AgentID>
</xml>
```

## App 回调 — 图片消息 (解密后 XML)

```xml
<xml>
  <ToUserName><![CDATA[corpAgent]]></ToUserName>
  <FromUserName><![CDATA[user002]]></FromUserName>
  <CreateTime>1700000001</CreateTime>
  <MsgType><![CDATA[image]]></MsgType>
  <PicUrl><![CDATA[https://example.com/pic.jpg]]></PicUrl>
  <MediaId><![CDATA[media_abc123]]></MediaId>
  <MsgId>1234567891</MsgId>
  <AgentID>1000001</AgentID>
</xml>
```

## App 回调 — 事件消息 (解密后 XML)

```xml
<xml>
  <ToUserName><![CDATA[corpAgent]]></ToUserName>
  <FromUserName><![CDATA[user003]]></FromUserName>
  <CreateTime>1700000002</CreateTime>
  <MsgType><![CDATA[event]]></MsgType>
  <Event><![CDATA[subscribe]]></Event>
  <AgentID>1000001</AgentID>
</xml>
```
