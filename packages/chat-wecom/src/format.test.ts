import { describe, it, expect } from "vite-plus/test";

import { WeComFormatConverter } from "./format";

const converter = new WeComFormatConverter();

describe("WeComFormatConverter", () => {
  describe("toAst", () => {
    it("parses plain text", () => {
      const ast = converter.toAst("Hello world");
      expect(ast.type).toBe("root");
    });

    it("parses bold text", () => {
      const ast = converter.toAst("**bold**");
      expect(ast.children[0].type).toBe("paragraph");
    });

    it("parses italic text", () => {
      const ast = converter.toAst("*italic*");
      expect(ast.children[0].type).toBe("paragraph");
    });

    it("parses inline code", () => {
      const ast = converter.toAst("`code`");
      expect(ast.children[0].type).toBe("paragraph");
    });

    it("parses code block", () => {
      const ast = converter.toAst("```\ncode\n```");
      expect(ast.children[0].type).toBe("code");
    });

    it("parses link", () => {
      const ast = converter.toAst("[text](https://example.com)");
      expect(ast.children[0].type).toBe("paragraph");
    });
  });

  describe("fromAst", () => {
    it("renders plain text", () => {
      const ast = converter.toAst("Hello");
      const result = converter.fromAst(ast);
      expect(result).toContain("Hello");
    });

    it("renders bold text", () => {
      const ast = converter.toAst("**bold**");
      const result = converter.fromAst(ast);
      expect(result).toContain("**bold**");
    });

    it("roundtrips markdown", () => {
      const md = "Hello **world** and *everyone*";
      const ast = converter.toAst(md);
      const result = converter.fromAst(ast);
      expect(result).toContain("Hello");
      expect(result).toContain("**world**");
      expect(result).toContain("*everyone*");
    });
  });
});
