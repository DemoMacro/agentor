# Agentor

![GitHub](https://img.shields.io/github/license/DemoMacro/agentor)
[![Contributor Covenant](https://img.shields.io/badge/Contributor%20Covenant-2.1-4baaaa.svg)](https://www.contributor-covenant.org/version/2/1/code_of_conduct/)

> A toolkit for building AI agents, with full TypeScript support.

## Packages

- **[@agentor/dashscope](./packages/dashscope/README.md)** - Alibaba Cloud DashScope (Bailian) API provider

## Quick Start

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
- 📚 [DashScope Documentation](./packages/dashscope/README.md)

## License

This project is licensed under the MIT License - see the [LICENSE](./LICENSE) file for details.

---

Built with ❤️ by [Demo Macro](https://www.demomacro.com/)
