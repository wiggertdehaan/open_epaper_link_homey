'use strict';

/**
 * Runs at most `limit` async tasks at a time; the rest wait their turn in
 * arrival order.
 *
 * @param {number} limit
 * @returns {function(function(): Promise<*>): Promise<*>}
 */
function createLimiter(limit) {
  let active = 0;
  const waiting = [];

  const next = () => {
    if (active >= limit || waiting.length === 0) return;
    active++;
    const { task, resolve, reject } = waiting.shift();
    Promise.resolve()
      .then(task)
      .then(resolve, reject)
      .finally(() => {
        active--;
        next();
      })
      // The task's own outcome went to resolve/reject above; nothing is left
      // that could reject here.
      .catch(() => {});
  };

  return (task) => new Promise((resolve, reject) => {
    waiting.push({ task, resolve, reject });
    next();
  });
}

module.exports = { createLimiter };
