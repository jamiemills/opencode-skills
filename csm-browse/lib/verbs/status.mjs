import { connect } from '../cdp.mjs';
import { readFile, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { sessionDir } from '../session.mjs';

export async function run({ args, state, verb }) {
  if (verb === 'status') {
    const client = await connect(state);

    const versionResult = await client.send('Browser.getVersion');

    const { targetInfos } = await client.send('Target.getTargets');
    const pages = targetInfos.filter(t => t.type === 'page');

    let currentUrl = null;
    if (pages.length > 0) {
      currentUrl = pages[0].url;
    }

    const sDir = sessionDir(state.sid);
    const pidFile = join(sDir, 'daemon.pid');
    const readyMarker = join(sDir, 'daemon.ready');
    let daemonAlive = false;
    let daemonPid = null;

    if (existsSync(readyMarker)) {
      try {
        if (existsSync(pidFile)) {
          const raw = await readFile(pidFile, 'utf-8');
          daemonPid = parseInt(raw.trim(), 10);
        }
        if (daemonPid) {
          try {
            process.kill(daemonPid, 0);
            daemonAlive = true;
          } catch {}
        }
      } catch {}
    }

    let artifactCount = 0;
    try {
      artifactCount = (await readdir(join(state.sessionDir, 'artifacts'))).length;
    } catch {}

    console.log(JSON.stringify({
      version: versionResult && versionResult.product,
      userAgent: versionResult && versionResult.userAgent,
      currentUrl,
      daemonAlive,
      ports: { internal: state.internalPort, public: state.publicPort },
      artifactCount
    }));

    await client.close();
    return;
  }
}
