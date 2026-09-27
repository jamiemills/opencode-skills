// Test-only exec-layer seam (F-068-2). Production modules keep `execLayer`
// for internal DI; the MUTATION API belongs here so no production code can
// import it, and a forgotten reset cannot order-contaminate the next test
// file via a module that ships to runtime.
//
import { execLayer, realExecLayer } from "../../../lib/docker.mjs";
import { hostPortProbe } from "../../../lib/ports.mjs";

export { execLayer, realExecLayer };

export function setExecLayerForTests(layer) {
  Object.assign(execLayer, layer ?? realExecLayer);
}

const realHostProbe = hostPortProbe.isFree;

export function setHostPortProbeForTests(fn) {
  hostPortProbe.isFree = fn ?? realHostProbe;
}
