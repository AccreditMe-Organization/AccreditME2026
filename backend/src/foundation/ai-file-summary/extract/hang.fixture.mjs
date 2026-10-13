// ACC-193 test fixture — a stand-in PDF worker that announces a document and
// then never sends a page, so the extractor's timeout and slots can be tested.
// Named *.fixture.mjs, not *.worker.mjs, so `nest build` does not ship it.
import { parentPort } from 'node:worker_threads';

parentPort.postMessage({ type: 'meta', numPages: 3 });
setInterval(() => undefined, 1_000);
