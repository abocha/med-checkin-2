export function createHostActionQueue({ maxSize = 50 } = {}) {
  const queue = [];
  const limit = Math.max(1, Number(maxSize) || 50);

  return {
    enqueue(action) {
      if (!action || typeof action !== 'object' || typeof action.type !== 'string') {
        throw new TypeError('Host action must be an object with a type');
      }
      queue.push(structuredClone(action));
      if (queue.length > limit) queue.splice(0, queue.length - limit);
    },
    drain() {
      return queue.splice(0, queue.length);
    },
    get size() { return queue.length; }
  };
}
