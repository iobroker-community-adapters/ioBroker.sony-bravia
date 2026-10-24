'use strict';

const assert = require('node:assert');
const path = require('node:path');
const { tests } = require('@iobroker/testing');

// Run integration tests - See https://github.com/ioBroker/testing for a detailed explanation and further options
tests.integration(path.join(__dirname, '..'), {
    defineAdditionalTests({ suite }) {
        // the harness is reset before every test, so every test starts the adapter itself
        suite('Remote control (sendTo)', getHarness => {
            const sendTo = (harness, command, message) =>
                new Promise(resolve => harness.sendTo('sony-bravia.0', command, message, resolve));

            it('remoteInfo lists apps and inputs', async function () {
                this.timeout(60_000);
                const harness = getHarness();
                await harness.startAdapterAndWait();
                const response = await sendTo(harness, 'remoteInfo', {});
                assert.deepStrictEqual(response, { apps: [], inputs: [] });
            });

            it('discover answers with a list for the IP field', async function () {
                this.timeout(60_000);
                const harness = getHarness();
                await harness.startAdapterAndWait();
                const response = await sendTo(harness, 'discover', {});
                // no TV in the CI network, but the answer must be a list for autocompleteSendTo
                assert.ok(Array.isArray(response));
            });

            it('remote answers with an error while no TV is configured', async function () {
                this.timeout(60_000);
                const harness = getHarness();
                await harness.startAdapterAndWait();
                const response = await sendTo(harness, 'remote', { key: 'AAAAAQAAAAEAAAB0Aw==' });
                assert.strictEqual(response.error, 'Please configure the Sony Bravia adapter');
            });
        });
    },
});
