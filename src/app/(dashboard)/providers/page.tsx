// src/app/(dashboard)/providers/page.tsx
import { redirect } from "next/navigation";

// The provider catalog grid + "your providers" list moved to /models (single page,
// styled after the reference grid: category sections, provider cards, no separate
// catalog-vs-configured split). Provider detail stays at /providers/[id].
export default function ProvidersPage() {
  redirect("/models");
}
