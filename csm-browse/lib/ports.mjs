import { isPortFree, pgrepMatch } from './docker.mjs';

const PORT_POOL_START = 9224;
const PORT_POOL_END = 9234;

export async function allocate(container) {
  for (let p = PORT_POOL_START; p <= PORT_POOL_END; p++) {
    const internal = p;
    const pub = p + 1;

    const internalFree = await isPortFree(container, internal);
    if (!internalFree) continue;

    const publicFree = await isPortFree(container, pub);
    if (!publicFree) continue;

    const socatMatches = await pgrepMatch(container, `TCP-LISTEN:${pub}`);
    if (socatMatches.length > 0) continue;

    return { internal, public: pub };
  }

  throw new Error(
    `No free port pair available in range ${PORT_POOL_START}-${PORT_POOL_END}`
  );
}

export async function release(state) {
  // T007 handles full cleanup — ports freed when session is destroyed
}
