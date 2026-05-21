import { describe, it, expect } from "vite-plus/test";

import { QQBotFormatConverter } from "./format";

const converter = new QQBotFormatConverter();

describe("QQBotFormatConverter", () => {
  describe("toAst", () => {
    it("parses plain text", () => {
      const ast = converter.toAst("Hello world");
      expect(ast.type).toBe("root");
    });

    it("parses bold text", () => {
      const ast = converter.toAst("**bold**");
      expect(ast.children[0].type).toBe("paragraph");
    });

    it("parses code block", () => {
      const ast = converter.toAst("```\ncode\n```");
      expect(ast.children[0].type).toBe("code");
    });
  });

  describe("fromAst", () => {
    it("roundtrips markdown", () => {
      const md = "Hello **world**";
      const ast = converter.toAst(md);
      const result = converter.fromAst(ast);
      expect(result).toContain("**world**");
    });
  });
});
