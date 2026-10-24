'use strict';

const assert = require('node:assert');
const path = require('node:path');
const { tests } = require('@iobroker/testing');

// Run integration tests - See https://github.com/ioBroker/testing for a detailed explanation and further options
tests.integration(path.join(__dirname, '..'), {
    defineAdditionalTests({ suite }) {
        suite('Type-detector', getHarness => {
            it('detects the channel tv as device type tv', async function () {
                this.timeout(60_000);
                const harness = getHarness();
                await harness.startAdapterAndWait();
                // the objects are created in onReady, give it a moment
                await new Promise(resolve => setTimeout(resolve, 2000));

                const list = await harness.objects.getObjectListAsync({
                    startkey: 'sony-bravia.0.',
                    endkey: 'sony-bravia.0.香',
                });
                const objects = {};
                for (const row of list.rows) {
                    objects[row.id] = row.value;
                }

                const { ChannelDetector } = require('@iobroker/type-detector');
                const controls = new ChannelDetector().detect({
                    objects,
                    id: 'sony-bravia.0.tv',
                    _keysOptional: Object.keys(objects),
                    _usedIdsOptional: [],
                });
                assert.ok(controls && controls.length, 'nothing detected');
                const tv = controls.find(control => control.type === 'tv');
                assert.ok(tv, `detected: ${controls.map(control => control.type).join(', ')}`);

                const found = {};
                for (const state of tv.states) {
                    if (state.id) {
                        found[state.name] = state.id.replace('sony-bravia.0.', '');
                    }
                }
                console.log(`Detected tv states: ${JSON.stringify(found)}`);
                assert.deepStrictEqual(found, {
                    POWER: 'tv.power',
                    KEY: 'tv.key',
                    VOLUME: 'tv.volume',
                    MUTE: 'tv.muted',
                    VOLUME_UP: 'tv.volumeUp',
                    VOLUME_DOWN: 'tv.volumeDown',
                    INPUT: 'tv.input',
                    APP: 'tv.app',
                    UNREACH: 'tv.unreach',
                });
            });
        });

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
