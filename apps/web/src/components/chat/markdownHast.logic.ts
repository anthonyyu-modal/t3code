export function plainHastText(node: unknown): string | null {
  if (!node || typeof node !== "object" || !("children" in node) || !Array.isArray(node.children)) {
    return null;
  }
  const parts = node.children.map((child) => {
    if (
      child &&
      typeof child === "object" &&
      "type" in child &&
      child.type === "text" &&
      "value" in child &&
      typeof child.value === "string"
    ) {
      return child.value;
    }
    return null;
  });
  return parts.every((part) => part !== null) ? parts.join("") : null;
}

export function hastPlainTextDeep(node: unknown): string {
  if (!node || typeof node !== "object") return "";
  if ("type" in node && node.type === "text" && "value" in node && typeof node.value === "string") {
    return node.value;
  }
  if (!("children" in node) || !Array.isArray(node.children)) return "";
  return node.children.map(hastPlainTextDeep).join("");
}

export function hastHasText(node: unknown): boolean {
  if (!node || typeof node !== "object") return false;
  if (
    "type" in node &&
    node.type === "text" &&
    "value" in node &&
    typeof node.value === "string" &&
    node.value.trim().length > 0
  ) {
    return true;
  }
  return "children" in node && Array.isArray(node.children) && node.children.some(hastHasText);
}

const INLINE_CODE_WRAPPER_TAGS = new Set(["strong", "em", "del"]);

export function isSoleInlineCodeNode(node: unknown): boolean {
  let current: unknown = node;
  while (
    current &&
    typeof current === "object" &&
    "children" in current &&
    Array.isArray(current.children)
  ) {
    const meaningful = current.children.filter(
      (child) =>
        !(
          child &&
          typeof child === "object" &&
          "type" in child &&
          child.type === "text" &&
          "value" in child &&
          typeof child.value === "string" &&
          child.value.trim().length === 0
        ),
    );
    if (meaningful.length !== 1) return false;
    const only = meaningful[0];
    if (
      !only ||
      typeof only !== "object" ||
      !("type" in only) ||
      only.type !== "element" ||
      !("tagName" in only) ||
      typeof only.tagName !== "string"
    ) {
      return false;
    }
    if (only.tagName === "code") return true;
    if (INLINE_CODE_WRAPPER_TAGS.has(only.tagName)) {
      current = only;
      continue;
    }
    return false;
  }
  return false;
}
