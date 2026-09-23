// Karma configuration file, see link for more information
// https://karma-runner.github.io/1.0/config/configuration-file.html

// ACC-47 — added because CI needs a headless Chrome launcher with
// --no-sandbox (containerized runners generally lack the kernel
// capabilities Chrome's own sandbox needs — a well-known, common cause of
// "Failed to start Chrome" in CI, and the exact class of local Chrome/Karma
// issue already hit more than once this session). Angular CLI's own
// default in-memory karma config (used when no karmaConfig path is set,
// which was the case before this file existed) has no such launcher —
// only the vanilla ChromeHeadless one, unsuitable for CI as-is.
//
// Local `ng test` is unaffected: the default `browsers` list below still
// points at the ordinary `Chrome` launcher. ChromeHeadlessCI is opt-in,
// only used when CI passes --browsers=ChromeHeadlessCI explicitly.
// ACC-127 — THE SPEC ORDER SEED IS CHOSEN HERE AND PRINTED, so a failure
// caused by spec order can be reproduced instead of only re-run.
//
// Jasmine randomises spec order by default — `jasmine-core`'s own Env:
// `this.random = 'random' in options ? options.random : true`. The
// `client.jasmine` block below used to be empty, so ordering was random with a
// fresh seed every run AND the `progress` reporter never printed it. A failure
// that depended on order was therefore not reproducible by anyone, with or
// without the CI log — which is exactly what happened on ACC-127's CI run,
// where one spec of 685 failed in teardown and six local runs could not
// reproduce it.
//
// Choosing the seed in Node rather than in the browser is what makes it
// printable: karma-jasmine passes `client.jasmine` straight to the browser's
// jasmine env, so this process knows the seed before the browser uses it.
//
// Reproduce a specific order:  JASMINE_SEED=12345 npx ng test --watch=false
const seed = process.env.JASMINE_SEED || String(Math.floor(Math.random() * 100000));
console.log(`\nJasmine spec order seed: ${seed}  (reproduce with JASMINE_SEED=${seed})\n`);

module.exports = function (config) {
  config.set({
    basePath: '',
    frameworks: ['jasmine', '@angular-devkit/build-angular'],
    plugins: [
      require('karma-jasmine'),
      require('karma-chrome-launcher'),
      require('karma-jasmine-html-reporter'),
      require('karma-coverage'),
      require('@angular-devkit/build-angular/plugins/karma'),
    ],
    client: {
      jasmine: {
        // Random order is KEPT, deliberately — it is what surfaces one spec
        // leaking state into another, and ACC-127's CI run is the proof that
        // it earns its keep. Pinning `random: false` would make CI green and
        // hide the next leak. What was missing was never the randomness, it
        // was the seed being unrecoverable; see the top of this file.
        random: true,
        seed,
      },
      clearContext: false, // leave Jasmine Spec Runner output visible in browser
    },
    jasmineHtmlReporter: {
      suppressAll: true, // removes the duplicated traces
    },
    coverageReporter: {
      dir: require('path').join(__dirname, './coverage/frontend'),
      subdir: '.',
      reporters: [{ type: 'html' }, { type: 'text-summary' }],
    },
    reporters: ['progress', 'kjhtml'],
    port: 9876,
    colors: true,
    logLevel: config.LOG_INFO,
    autoWatch: true,
    browsers: ['Chrome'],
    // ACC-47 — CI-only launcher. --no-sandbox: containerized runners
    // usually can't satisfy Chrome's sandbox requirements. --disable-gpu:
    // no GPU available in CI, avoids related startup errors.
    // --disable-dev-shm-usage: CI containers often have a small /dev/shm,
    // which crashes Chrome under load — this makes it use /tmp instead.
    customLaunchers: {
      ChromeHeadlessCI: {
        base: 'ChromeHeadless',
        flags: ['--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage'],
      },
    },
    // ACC-47 — fail fast instead of hanging: if Chrome doesn't connect or
    // go quiet, these fire well before the CI job's own timeout-minutes
    // backstop would.
    captureTimeout: 60000,
    browserDisconnectTimeout: 20000,
    browserNoActivityTimeout: 30000,
    singleRun: false,
    restartOnFileChange: true,
  });
};
