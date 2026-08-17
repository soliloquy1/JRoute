export interface NavItem {
  label: string;
  href: string;
  icon: string; // Material Symbols ligature name
}

/**
 * Flat, ordered nav. Presets (the SillyTavern kind) are first-class: they are the
 * thing a chat actually runs through, so they sit directly under Providers.
 */
export const NAV_ITEMS: NavItem[] = [
  { label: "Overview", href: "/", icon: "home" },
  { label: "Providers", href: "/providers", icon: "cable" },
  { label: "Models", href: "/models", icon: "model_training" },
  { label: "Analytics", href: "/analytics", icon: "monitoring" },
  { label: "API Keys", href: "/keys", icon: "key" },
  { label: "Presets", href: "/rich-presets", icon: "tune" },
  { label: "Logit Bias", href: "/logit-bias", icon: "filter_alt" },
  { label: "Prompts & Lorebooks", href: "/prompts", icon: "edit_note" },
  { label: "MCP Servers", href: "/mcp", icon: "dns" },
  { label: "Settings", href: "/settings", icon: "settings" },
];
