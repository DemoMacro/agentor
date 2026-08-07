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

export function cardToTemplateCard(card: CardElement): WeComTemplateCard {
  const cardType = inferCardType(card);
  switch (cardType) {
    case "button_interaction":
      return buildButtonInteraction(card);
    case "vote_interaction":
      return buildVoteInteraction(card);
    case "multiple_interaction":
      return buildMultipleInteraction(card);
    case "news_notice":
      return buildNewsNotice(card);
    default:
      return buildTextNotice(card);
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

function buildCardAction(card: CardElement): WeComCardAction {
  if (card.imageUrl) return { type: 1, url: card.imageUrl };
  return { type: 1, url: "https://work.weixin.qq.com" };
}

function buildTaskId(): string {
  return `card_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

// --- text_notice ---

function buildTextNotice(card: CardElement): WeComTemplateCard {
  const mainTitle = buildMainTitle(card);
  const fields = collectFields(card.children);
  const links = mapLinkElements(card.children);
  const actions = collectActions(card.children);
  const subText = collectTexts(card.children);
  const emphasis = collectBoldTexts(card.children);

  if (actions) {
    links.push(...mapLinkButtons(actions.children));
  }

  return {
    card_type: "text_notice",
    main_title: mainTitle,
    ...(emphasis ? { emphasis_content: emphasis } : {}),
    ...(subText ? { sub_title_text: subText } : {}),
    ...(fields.length > 0 ? { horizontal_content_list: mapFields(fields) } : {}),
    ...(links.length > 0 ? { jump_list: links } : {}),
    card_action: buildCardAction(card),
    task_id: buildTaskId(),
  };
}

// --- news_notice ---

function buildNewsNotice(card: CardElement): WeComTemplateCard {
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

  return {
    card_type: "news_notice",
    main_title: mainTitle,
    ...(cardImage ? { card_image: cardImage } : {}),
    ...(subText ? { sub_title_text: subText } : {}),
    ...(fields.length > 0 ? { horizontal_content_list: mapFields(fields) } : {}),
    ...(links.length > 0 ? { jump_list: links } : {}),
    card_action: buildCardAction(card),
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

  return {
    card_type: "button_interaction",
    main_title: mainTitle,
    ...(emphasis ? { emphasis_content: emphasis } : {}),
    ...(subText ? { sub_title_text: subText } : {}),
    ...(fields.length > 0 ? { horizontal_content_list: mapFields(fields) } : {}),
    ...(links.length > 0 ? { jump_list: links } : {}),
    ...(buttons.length > 0 ? { button_list: buttons } : {}),
    card_action: buildCardAction(card),
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
