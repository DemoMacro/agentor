// 企业微信 Template Card 转换器
// Chat SDK CardElement → WeComTemplateCard

import type {
  CardElement,
  CardChild,
  ActionsElement,
  ButtonElement,
  LinkButtonElement,
  SelectElement,
  RadioSelectElement,
  FieldsElement,
  FieldElement,
  TextElement,
  ImageElement,
  LinkElement,
  SectionElement,
} from "chat";

import type {
  WeComTemplateCard,
  WeComCardType,
  WeComButtonItem,
  WeComHorizontalContentItem,
  WeComJumpItem,
  WeComCardAction,
} from "./types";

export interface CardConvertOptions {
  // text_notice/news_notice 的 card_action 必填且必须跳转（企微协议 type∈[1,2]）。
  // CardElement 无"整卡跳转"字段，无明确目标时用此 url 兜底；缺省则用内置默认。
  cardActionUrl?: string;
}

export function cardToTemplateCard(
  card: CardElement,
  options?: CardConvertOptions,
): WeComTemplateCard {
  const cardActionUrl = options?.cardActionUrl;
  const cardType = inferCardType(card);
  switch (cardType) {
    case "button_interaction":
      return buildButtonInteraction(card);
    case "vote_interaction":
      return buildVoteInteraction(card);
    case "multiple_interaction":
      return buildMultipleInteraction(card);
    case "news_notice":
      return buildNewsNotice(card, cardActionUrl);
    default:
      return buildTextNotice(card, cardActionUrl);
  }
}

function inferCardType(card: CardElement): WeComCardType {
  for (const child of card.children) {
    if (child.type === "actions") {
      const actions = child as ActionsElement;
      const selects = actions.children.filter((c): c is SelectElement => c.type === "select");
      const radios = actions.children.filter(
        (c): c is RadioSelectElement => c.type === "radio_select",
      );
      if (selects.length > 1) return "multiple_interaction";
      if (radios.length > 0 || selects.length === 1) return "vote_interaction";
      return "button_interaction";
    }
  }

  if (card.imageUrl || hasImageChild(card.children)) {
    return "news_notice";
  }

  return "text_notice";
}

function hasImageChild(children: CardChild[]): boolean {
  for (const child of children) {
    if (child.type === "image") return true;
    if (child.type === "section") {
      const section = child as SectionElement;
      if (hasImageChild(section.children)) return true;
    }
  }
  return false;
}

function collectTexts(children: CardChild[]): string {
  const parts: string[] = [];
  for (const child of children) {
    if (child.type === "text") {
      const text = child as TextElement;
      if (text.style !== "bold") parts.push(text.content);
    }
  }
  return parts.join("\n");
}

function collectBoldTexts(children: CardChild[]): { title: string; desc?: string } | null {
  for (const child of children) {
    if (child.type === "text") {
      const text = child as TextElement;
      if (text.style === "bold") {
        return { title: text.content };
      }
    }
  }
  return null;
}

function collectFields(children: CardChild[]): FieldElement[] {
  for (const child of children) {
    if (child.type === "fields") {
      return (child as FieldsElement).children;
    }
  }
  return [];
}

function collectActions(children: CardChild[]): ActionsElement | null {
  for (const child of children) {
    if (child.type === "actions") return child as ActionsElement;
  }
  return null;
}

function mapButtonStyle(style?: string): 1 | 2 | 3 | 4 {
  switch (style) {
    case "primary":
      return 4;
    case "danger":
      return 2;
    case "default":
      return 1;
    default:
      return 1;
  }
}

// ButtonElement.id 作为企微 button 的 key；用户点击卡片按钮时企微以 EventKey 回传该值，
// handleWebhook 将其映射为 ActionEvent.actionId，供 chat.onAction(actionId, handler) 路由
function mapButtons(
  children: (ButtonElement | LinkButtonElement | SelectElement | RadioSelectElement)[],
): WeComButtonItem[] {
  return children
    .filter((c): c is ButtonElement => c.type === "button")
    .map((btn) => ({
      text: btn.label,
      style: mapButtonStyle(btn.style),
      key: btn.id,
      ...(btn.callbackUrl ? { type: 1 as const, url: btn.callbackUrl } : {}),
    }));
}

function mapLinkButtons(
  children: (ButtonElement | LinkButtonElement | SelectElement | RadioSelectElement)[],
): WeComJumpItem[] {
  const links: WeComJumpItem[] = [];
  for (const child of children) {
    if (child.type === "link-button") {
      links.push({
        type: 1,
        url: (child as LinkButtonElement).url,
        title: (child as LinkButtonElement).label,
      });
    }
  }
  return links;
}

function mapFields(fields: FieldElement[]): WeComHorizontalContentItem[] {
  return fields.map((field) => {
    const isUrl = field.value.startsWith("http://") || field.value.startsWith("https://");
    return {
      keyname: field.label,
      value: field.value,
      ...(isUrl ? { type: 1 as const, url: field.value } : {}),
    };
  });
}

function mapLinkElements(children: CardChild[]): WeComJumpItem[] {
  const links: WeComJumpItem[] = [];
  for (const child of children) {
    if (child.type === "link") {
      const link = child as LinkElement;
      links.push({ type: 1, url: link.url, title: link.label });
    }
  }
  return links;
}

function buildMainTitle(card: CardElement): { title: string; desc?: string } {
  return {
    title: card.title ?? "",
    ...(card.subtitle ? { desc: card.subtitle } : {}),
  };
}

// 企微协议要求 text_notice/news_notice 的 card_action 必填且必须跳转（type∈[1,2]），
// CardElement 无"整卡跳转"字段，无明确目标时用此占位（可通过 cardActionUrl 覆盖）。
const WECOM_DEFAULT_CARD_ACTION_URL = "https://work.weixin.qq.com";

// card_action 的 url 优先复用卡片已有链接（jump_list 第一项，对齐 chat-sdk LinkElement 语义），
// 其次头部图片；两者皆无时返回 undefined，由调用方按各卡片类型的必填约束决定是否兜底。
function buildCardAction(card: CardElement, links: WeComJumpItem[]): WeComCardAction | undefined {
  const url = card.imageUrl ?? links[0]?.url;
  return url ? { type: 1, url } : undefined;
}

function buildTaskId(): string {
  return `card_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

// --- text_notice ---

function buildTextNotice(card: CardElement, cardActionUrl?: string): WeComTemplateCard {
  const mainTitle = buildMainTitle(card);
  const fields = collectFields(card.children);
  const links = mapLinkElements(card.children);
  const actions = collectActions(card.children);
  const subText = collectTexts(card.children);
  const emphasis = collectBoldTexts(card.children);

  if (actions) {
    links.push(...mapLinkButtons(actions.children));
  }

  // card_action 必填：优先卡片已有链接/图片，无则用配置或内置默认兜底
  const card_action = buildCardAction(card, links) ?? {
    type: 1,
    url: cardActionUrl ?? WECOM_DEFAULT_CARD_ACTION_URL,
  };

  return {
    card_type: "text_notice",
    main_title: mainTitle,
    ...(emphasis ? { emphasis_content: emphasis } : {}),
    ...(subText ? { sub_title_text: subText } : {}),
    ...(fields.length > 0 ? { horizontal_content_list: mapFields(fields) } : {}),
    ...(links.length > 0 ? { jump_list: links } : {}),
    card_action,
    task_id: buildTaskId(),
  };
}

// --- news_notice ---

function buildNewsNotice(card: CardElement, cardActionUrl?: string): WeComTemplateCard {
  const mainTitle = buildMainTitle(card);
  const fields = collectFields(card.children);
  const links = mapLinkElements(card.children);
  const actions = collectActions(card.children);
  const subText = collectTexts(card.children);

  let cardImage: { url: string; aspect_ratio?: number } | undefined;
  if (card.imageUrl) {
    cardImage = { url: card.imageUrl };
  }

  // 查找 ImageElement
  if (!cardImage) {
    for (const child of card.children) {
      if (child.type === "image") {
        cardImage = { url: (child as ImageElement).url };
        break;
      }
    }
  }

  if (actions) {
    links.push(...mapLinkButtons(actions.children));
  }

  // card_action 必填：优先卡片已有链接/图片，无则用配置或内置默认兜底
  const card_action = buildCardAction(card, links) ?? {
    type: 1,
    url: cardActionUrl ?? WECOM_DEFAULT_CARD_ACTION_URL,
  };

  return {
    card_type: "news_notice",
    main_title: mainTitle,
    ...(cardImage ? { card_image: cardImage } : {}),
    ...(subText ? { sub_title_text: subText } : {}),
    ...(fields.length > 0 ? { horizontal_content_list: mapFields(fields) } : {}),
    ...(links.length > 0 ? { jump_list: links } : {}),
    card_action,
    task_id: buildTaskId(),
  };
}

// --- button_interaction ---

function buildButtonInteraction(card: CardElement): WeComTemplateCard {
  const mainTitle = buildMainTitle(card);
  const fields = collectFields(card.children);
  const subText = collectTexts(card.children);
  const emphasis = collectBoldTexts(card.children);
  const actions = collectActions(card.children);

  const buttons = actions ? mapButtons(actions.children) : [];
  const links = mapLinkElements(card.children);
  if (actions) links.push(...mapLinkButtons(actions.children));

  // card_action 可选：仅当卡片有明确链接/图片时设置，避免无意图时整卡误跳
  const cardAction = buildCardAction(card, links);

  return {
    card_type: "button_interaction",
    main_title: mainTitle,
    ...(emphasis ? { emphasis_content: emphasis } : {}),
    ...(subText ? { sub_title_text: subText } : {}),
    ...(fields.length > 0 ? { horizontal_content_list: mapFields(fields) } : {}),
    ...(links.length > 0 ? { jump_list: links } : {}),
    ...(buttons.length > 0 ? { button_list: buttons } : {}),
    ...(cardAction ? { card_action: cardAction } : {}),
    task_id: buildTaskId(),
  };
}

// --- vote_interaction ---

function buildVoteInteraction(card: CardElement): WeComTemplateCard {
  const mainTitle = buildMainTitle(card);
  const actions = collectActions(card.children);
  const subText = collectTexts(card.children);

  let checkbox:
    | { question_key: string; option_list: Array<{ id: string; text: string }>; mode: 0 | 1 }
    | undefined;
  let submitButton: { text: string; key: string } | undefined;

  if (actions) {
    for (const child of actions.children) {
      if (child.type === "radio_select") {
        const radio = child as RadioSelectElement;
        checkbox = {
          question_key: radio.id,
          option_list: radio.options.map((opt) => ({ id: opt.value, text: opt.label })),
          mode: 0,
        };
        submitButton = { text: "提交", key: `${radio.id}_submit` };
        break;
      }
      if (child.type === "select") {
        const select = child as SelectElement;
        checkbox = {
          question_key: select.id,
          option_list: select.options.map((opt) => ({ id: opt.value, text: opt.label })),
          mode: 1,
        };
        submitButton = { text: "提交", key: `${select.id}_submit` };
        break;
      }
    }
  }

  return {
    card_type: "vote_interaction",
    main_title: mainTitle,
    ...(subText ? { sub_title_text: subText } : {}),
    ...(checkbox ? { checkbox } : {}),
    ...(submitButton ? { submit_button: submitButton } : {}),
    task_id: buildTaskId(),
  };
}

// --- multiple_interaction ---

function buildMultipleInteraction(card: CardElement): WeComTemplateCard {
  const mainTitle = buildMainTitle(card);
  const actions = collectActions(card.children);
  const subText = collectTexts(card.children);

  const selectList: Array<{
    question_key: string;
    title: string;
    selected_id?: string;
    option_list: Array<{ id: string; text: string }>;
  }> = [];

  let submitButton: { text: string; key: string } | undefined;

  if (actions) {
    for (const child of actions.children) {
      if (child.type === "select") {
        const select = child as SelectElement;
        selectList.push({
          question_key: select.id,
          title: select.label,
          ...(select.initialOption ? { selected_id: select.initialOption } : {}),
          option_list: select.options.map((opt) => ({ id: opt.value, text: opt.label })),
        });
      }
      if (child.type === "radio_select" && !submitButton) {
        const radio = child as RadioSelectElement;
        submitButton = { text: "提交", key: `${radio.id}_submit` };
      }
    }
  }

  if (!submitButton && selectList.length > 0) {
    submitButton = { text: "提交", key: "multi_submit" };
  }

  return {
    card_type: "multiple_interaction",
    main_title: mainTitle,
    ...(subText ? { sub_title_text: subText } : {}),
    ...(selectList.length > 0 ? { select_list: selectList } : {}),
    ...(submitButton ? { submit_button: submitButton } : {}),
    task_id: buildTaskId(),
  };
}
