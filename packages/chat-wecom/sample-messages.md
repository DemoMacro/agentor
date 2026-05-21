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
  "create_time": 1700000000,
  "msgtype": "text",
  "text": {
    "content": "你好"
  }
}
```

## Bot 回调模式 — 图片消息

```json
{
  "msgid": "msg_234567",
  "aibotid": "bot_abc",
  "chatid": "chat_001",
  "chattype": "single",
  "from": {
    "userid": "user002"
  },
  "create_time": 1700000001,
  "msgtype": "image",
  "image": {
    "url": "https://example.com/image.enc",
    "aeskey": "base64-encoded-aes-key"
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
  "create_time": 1700000002,
  "msgtype": "mixed",
  "text": {
    "content": "描述文字"
  },
  "image": {
    "url": "https://example.com/mixed-image.enc",
    "aeskey": "base64-encoded-aes-key"
  }
}
```

## Bot WebSocket 模式 — 文本消息帧

```json
{
  "cmd": "ai_bot_msg",
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
