// src/components/dashboard/ConnectionList.tsx
"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import {
  DndContext,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  verticalListSortingStrategy,
  useSortable,
  arrayMove,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { Connection } from "@/lib/db/types.ts";
import { ConnectionRow } from "./ConnectionRow.tsx";
import { useToast } from "./ui.tsx";

export interface ConnectionListItem {
  connection: Connection;
  healthy: boolean;
}

function SortableRow({ connection, healthy }: ConnectionListItem) {
  const { attributes, listeners, setNodeRef, transform, transition } = useSortable({
    id: connection.id,
  });
  const style = { transform: CSS.Transform.toString(transform), transition };
  return (
    <div ref={setNodeRef} style={style} {...attributes} {...listeners}>
      <ConnectionRow connection={connection} healthy={healthy} />
    </div>
  );
}

export function ConnectionList({ items: initialItems }: { items: ConnectionListItem[] }) {
  const router = useRouter();
  const { toast } = useToast();
  const [items, setItems] = useState(initialItems);

  // Only re-sync from the server when the SET of connections changes (add/remove) — not on
  // every refresh. This keeps an optimistic local reorder in place (no flicker) while still
  // picking up added/removed connections.
  const idsKey = initialItems.map((i) => i.connection.id).join(",");
  useEffect(() => {
    setItems(initialItems);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idsKey]);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 8 } }));

  async function onDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = items.findIndex((item) => item.connection.id === active.id);
    const newIndex = items.findIndex((item) => item.connection.id === over.id);
    const reordered = arrayMove(items, oldIndex, newIndex);
    setItems(reordered);
    const res = await fetch("/api/connections/reorder", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ orderedIds: reordered.map((item) => item.connection.id) }),
    });
    if (!res.ok) {
      // Surface the failure to the operator (not console.error) and revert to server truth.
      toast("Failed to save connection order", "error");
      router.refresh();
      return;
    }
    // Success: the optimistic order is already shown. Skipping router.refresh() avoids the
    // reorder flicker (a full reload would briefly repaint the pre-reorder order).
  }

  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
      <SortableContext
        items={items.map((item) => item.connection.id)}
        strategy={verticalListSortingStrategy}
      >
        <div className="flex flex-col gap-2">
          {items.map((item) => (
            <SortableRow
              key={item.connection.id}
              connection={item.connection}
              healthy={item.healthy}
            />
          ))}
        </div>
      </SortableContext>
    </DndContext>
  );
}
