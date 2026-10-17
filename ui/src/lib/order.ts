/**
 * The list can hide some devices (disconnected, Hands-Free). When the user reorders only the visible
 * subset, hidden devices must keep their absolute positions: the visible ids are written back into
 * the slots previously occupied by visible ids, in their new order.
 */
export function mergeVisibleOrder(fullOrder: string[], visibleInNewOrder: string[]): string[] {
  const visible = new Set(visibleInNewOrder);
  const queue = [...visibleInNewOrder];
  const result = fullOrder.map((id) => (visible.has(id) ? queue.shift()! : id));
  // Ids the full order didn't know about (shouldn't happen) go to the end.
  return [...result, ...queue];
}

/** Moves an item in an array (pure). */
export function move<T>(items: T[], from: number, to: number): T[] {
  const next = items.slice();
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  return next;
}
