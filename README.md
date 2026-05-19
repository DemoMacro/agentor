# Agentor

![GitHub](https://img.shields.io/github/license/DemoMacro/agentor)
[![Contributor Covenant](https://img.shields.io/badge/Contributor%20Covenant-2.1-4baaaa.svg)](https://www.contributor-covenant.org/version/2/1/code_of_conduct/)

> A toolkit for building AI agents, with full TypeScript support.

## Packages

- **[@agentor/server](./packages/server/README.md)** - AI API compatibility layer (OpenAI / Anthropic compatible endpoints)
- **[@agentor/dashscope](./packages/dashscope/README.md)** - Alibaba Cloud DashScope (Bailian) API provider
- **[@agentor/chat-wecom](./packages/chat-wecom/README.md)** - WeChat Work (企业微信) Chat SDK adapter

## Quick Start

### Server

```bash
# Install with pnpm
$ pnpm add @agentor/server
```

```typescript
import { createServer, openaiHandler, anthropicHandler } from "@agentor/server";
import { createDashScope } from "@agentor/dashscope";
import { createProviderRegistry } from "ai";

const dashscope = createDashScope({ apiKey: process.env.DASHSCOPE_API_KEY });

const server = createServer({
  registry: createProviderRegistry({ dashscope }),
  handlers: [openaiHandler(), anthropicHandler()],
});

server.listen(3000);
// POST /v1/chat/completions  → OpenAI compatible
// POST /v1/messages          → Anthropic compatible
// GET  /v1/models            → Model list
```

### DashScope

```bash
# Install with npm
$ npm install @agentor/dashscope

# Install with yarn
$ yarn add @agentor/dashscope

# Install with pnpm
$ pnpm add @agentor/dashscope
```

```typescript
import { dashscope } from "@agentor/dashscope";
import { generateText } from "ai";

// Basic chat
const result = await generateText({
  model: dashscope("qwen3.5-flash"),
  prompt: "Hello, world!",
});

console.log(result.text);
```

### Chat WeCom

```bash
# Install with npm
$ npm install @agentor/chat-wecom

# Install with yarn
$ yarn add @agentor/chat-wecom

# Install with pnpm
$ pnpm add @agentor/chat-wecom
```

```typescript
import { createWeComWebhookAdapter } from "@agentor/chat-wecom";

// Send message to group via webhook
const adapter = createWeComWebhookAdapter({
  key: process.env.WECOM_WEBHOOK_KEY!,
});

const threadId = adapter.encodeThreadId({ key: process.env.WECOM_WEBHOOK_KEY! });
const result = await adapter.postMessage(threadId, "Hello from Agentor!");
```

## Development

### Prerequisites

- **Node.js** 18.x or higher
- **pnpm** 9.x or higher (recommended package manager)
- **Git** for version control

### Getting Started

1. **Clone the repository**:

   ```bash
   git clone https://github.com/DemoMacro/agentor.git
   cd agentor
   ```

2. **Install dependencies**:

   ```bash
   pnpm install
   ```

3. **Development mode**:

   ```bash
   pnpm dev
   ```

4. **Build all packages**:

   ```bash
   pnpm build
   ```

### Development Commands

```bash
pnpm dev            # Development mode with watch
pnpm build          # Build all packages
pnpm check          # Run code formatting and linting
```

## Contributing

We welcome contributions! Here's how to get started:

### Quick Setup

1. **Fork the repository** on GitHub
2. **Clone your fork**:

   ```bash
   git clone https://github.com/YOUR_USERNAME/agentor.git
   cd agentor
   ```

3. **Add upstream remote**:

   ```bash
   git remote add upstream https://github.com/DemoMacro/agentor.git
   ```

4. **Install dependencies**:

   ```bash
   pnpm install
   ```

5. **Development mode**:

   ```bash
   pnpm dev
   ```

### Development Workflow

1. **Code**: Follow our project standards
2. **Test**: `pnpm build && <test your changes>`
3. **Commit**: Use conventional commits (`feat:`, `fix:`, etc.)
4. **Push**: Push to your fork
5. **Submit**: Create a Pull Request to upstream repository

## Support & Community

- 📫 [Report Issues](https://github.com/DemoMacro/agentor/issues)
- 📚 [Server Documentation](./packages/server/README.md)
- 📚 [DashScope Documentation](./packages/dashscope/README.md)
- 📚 [Chat WeCom Documentation](./packages/chat-wecom/README.md)

## License

This project is licensed under the MIT License - see the [LICENSE](./LICENSE) file for details.

---

Built with ❤️ by [Demo Macro](https://www.demomacro.com/)
