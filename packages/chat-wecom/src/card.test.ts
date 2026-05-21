import type { CardElement } from "chat";
import { describe, it, expect } from "vite-plus/test";

import { cardToTemplateCard } from "./card";

describe("cardToTemplateCard", () => {
  it("infers text_notice for plain card", () => {
    const card: CardElement = {
      type: "card",
      title: "通知",
      children: [],
    };
    const result = cardToTemplateCard(card);
    expect(result.card_type).toBe("text_notice");
    expect(result.main_title.title).toBe("通知");
  });

  it("infers news_notice when imageUrl is present", () => {
    const card: CardElement = {
      type: "card",
      title: "图文",
      imageUrl: "https://example.com/img.png",
      children: [],
    };
    const result = cardToTemplateCard(card);
    expect(result.card_type).toBe("news_notice");
    expect(result.card_image?.url).toBe("https://example.com/img.png");
  });

  it("infers button_interaction when actions contain buttons", () => {
    const card: CardElement = {
      type: "card",
      title: "审批",
      children: [
        {
          type: "actions",
          children: [
            { type: "button", label: "同意", style: "primary", id: "approve" },
            { type: "button", label: "拒绝", style: "danger", id: "reject" },
          ],
        },
      ],
    };
    const result = cardToTemplateCard(card);
    expect(result.card_type).toBe("button_interaction");
    expect(result.button_list).toHaveLength(2);
    expect(result.button_list![0].text).toBe("同意");
    expect(result.button_list![0].style).toBe(4); // primary → 4
    expect(result.button_list![1].style).toBe(2); // danger → 2
  });

  it("infers vote_interaction for radio_select", () => {
    const card: CardElement = {
      type: "card",
      title: "投票",
      children: [
        {
          type: "actions",
          children: [
            {
              type: "radio_select",
              id: "vote1",
              label: "请选择",
              options: [
                { label: "选项A", value: "a" },
                { label: "选项B", value: "b" },
              ],
            },
          ],
        },
      ],
    };
    const result = cardToTemplateCard(card);
    expect(result.card_type).toBe("vote_interaction");
    expect(result.checkbox?.option_list).toHaveLength(2);
  });

  it("infers multiple_interaction for multiple selects", () => {
    const card: CardElement = {
      type: "card",
      title: "多选",
      children: [
        {
          type: "actions",
          children: [
            {
              type: "select",
              id: "s1",
              label: "分类",
              options: [
                { label: "X", value: "x" },
                { label: "Y", value: "y" },
              ],
            },
            {
              type: "select",
              id: "s2",
              label: "级别",
              options: [
                { label: "高", value: "high" },
                { label: "低", value: "low" },
              ],
            },
          ],
        },
      ],
    };
    const result = cardToTemplateCard(card);
    expect(result.card_type).toBe("multiple_interaction");
    expect(result.select_list).toHaveLength(2);
  });

  it("maps fields to horizontal_content_list", () => {
    const card: CardElement = {
      type: "card",
      title: "详情",
      children: [
        {
          type: "fields",
          children: [
            { type: "field", label: "申请人", value: "张三" },
            { type: "field", label: "链接", value: "https://example.com" },
          ],
        },
      ],
    };
    const result = cardToTemplateCard(card);
    expect(result.horizontal_content_list).toHaveLength(2);
    expect(result.horizontal_content_list![1].type).toBe(1); // URL → type 1
  });
});
