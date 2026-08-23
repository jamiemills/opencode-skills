export function planWork(items) {
  const bus = { emit: (_name) => {} };
  bus.emit("work.planned");
  return items;
}
