// 企业微信消息格式转换器: Markdown ↔ mdast AST

import { BaseFormatConverter, parseMarkdown, stringifyMarkdown } from "chat";
import type { Root } from "chat";

export class WeComFormatConverter extends BaseFormatConverter {
  toAst(platformText: string): Root {
    return parseMarkdown(platformText);
  }

  fromAst(ast: Root): string {
    return stringifyMarkdown(ast);
  }
}
