const ADOTestAdapter = require('./core-adapter');

class WdioAdoService {
  constructor(options) {
    this.options = options;
    this.adapter = new ADOTestAdapter(options);
    this.results = [];
  }

  async onPrepare() {
    await this.adapter.startRun(this.options.runTitle);
  }

  async afterTest(test, context, { error, duration, passed }) {
    let screenshotBase64 = null;
    if (!passed && typeof browser !== 'undefined' && browser.takeScreenshot) {
      try {
        screenshotBase64 = await browser.takeScreenshot();
      } catch (e) {
        console.error('[ado-test-adapter] Failed to capture screenshot:', e.message);
      }
    }

    this.results.push({
      title: test.title,
      identifier: test.fullTitle,
      passed,
      error: error ? error.message : null,
      duration,
      screenshotBase64
    });
  }

  async onComplete() {
    if (this.results.length > 0) {
      await this.adapter.publish(this.results);
    }
    await this.adapter.finishRun();
  }
}

module.exports = WdioAdoService;
