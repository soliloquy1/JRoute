export interface NavItem {
  label: string;
  href: string;
}

export interface NavGroup {
  group: string;
  items: NavItem[];
}

export const NAV_GROUPS: NavGroup[] = [
  { group: "OVERVIEW", items: [{ label: "Dashboard", href: "/" }] },
  { group: "PROVIDERS", items: [{ label: "Connections", href: "/providers" }] },
  {
    group: "KEYS & LOGS",
    items: [
      { label: "API keys", href: "/keys" },
      { label: "Request log", href: "/keys#log" },
    ],
  },
  {
    group: "PROMPTS & LOREBOOKS",
    items: [{ label: "Editor", href: "/prompts" }],
  },
];
