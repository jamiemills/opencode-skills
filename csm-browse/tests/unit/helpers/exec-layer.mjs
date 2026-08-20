// Test-only exec-layer seam (F-068-2). Production modules keep `execLayer`
// for internal DI; the MUTATION API belongs here so no production code can
// import it, and a forgotten reset cannot order-contaminate the next test
// file via a module that ships to runtime.
//
// Existing suites still import setExecLayerForTests from lib/docker.mjs
// (transitional re-export); R9 re-points them to this module, after which
// the docker.mjs alias is removed.
export { setExecLayerForTests, execLayer, realExecLayer } from '../../../lib/docker.mjs';
