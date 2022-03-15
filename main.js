/* jshint -W097 */// jshint strict:false
/*jslint node: true */
"use strict";

// you have to require the utils module and call adapter function
const utils = require('@iobroker/adapter-core'); // Get common adapter utils
const Controller = require(__dirname + '/lib/bravia');
const ping = require(__dirname + '/lib/ping');
// const objectHelper = require('@apollon/iobroker-tools').objectHelper; // Get common adapter utils
const http = require('http');

let isConnected = null;
let device;

// you have to call the adapter function and pass a options object
// name has to be set and has to be equal to adapters folder name and main file name excluding extension
// adapter will be restarted automatically every time as the configuration changed, e.g system.adapter.template.0
let adapter, statusInterval, powerStatusTimeout, playContentTimeout, terminateAppsTimeout, activeAppTimeout, volumeMuteTimeout, volumeSetTimeout;
function startAdapter(options) {
    options = options || {};
    Object.assign(options, {
        name: 'sony-bravia',
        stateChange: function (id, state) {
            if (!state.ack) {
                if (id.endsWith("info.powerStatusActive")) {
                    device.setPowerStatus(state.val).then(body => powerStatusTimeout = setTimeout(() => checkStatus(), 500)).catch(err => adapter.log.error(err));
                }
                else if (id.includes(".avContent.")) {
                    turnOverIfPowerIsActiv(id, uri => {
                        device.setPlayContent(uri).then(body => playContentTimeout = setTimeout(() => checkStatus(), 500)).catch(err => adapter.log.error(err));
                    });
                }
                else if (id.includes(".appControl.terminateApps")) {
                    ifPowerIsActiv(() => {
                        device.terminateApps().then(body => terminateAppsTimeout = setTimeout(() => checkStatus(), 1000)).catch(err => adapter.log.error(err));
                    });
                }
                else if (id.includes(".appControl.app.")) {
                    turnOverIfPowerIsActiv(id, uri => {
                        device.setActiveApp(uri).then(body => activeAppTimeout = setTimeout(() => checkStatus(), 2000)).catch(err => adapter.log.error(err));
                    });
                }
                else if (id.includes(".audio.volume.") && id.endsWith("mute")) {
                    device.setMute(state.val).then(body => volumeMuteTimeout = setTimeout(() => checkStatus(), 2000)).catch(err => adapter.log.error(err));
                }
                else if (id.includes(".audio.volume.") && id.endsWith("volume")) {
                    turnVolume(id, target => {
                        device.setVolume(target, state.val).then(body => volumeSetTimeout = setTimeout(() => checkStatus(), 2000)).catch(err => adapter.log.error(err));
                    });
                }
                else if (id && state) {
                    id = id.substring(id.lastIndexOf('.') + 1);
                    device.send(id);
                }
            }
        },
        ready: main,
        unload: (callback) => {
            try {
                adapter.setState('info.modelInformation', { val: "", ack: true });
                statusInterval && clearInterval(statusInterval);
                powerStatusTimeout && clearTimeout(powerStatusTimeout);
                playContentTimeout && clearTimeout(playContentTimeout);
                terminateAppsTimeout && clearTimeout(terminateAppsTimeout);
                activeAppTimeout && clearTimeout(activeAppTimeout);
                volumeMuteTimeout && clearTimeout(volumeMuteTimeout);
                volumeSetTimeout && clearTimeout(volumeSetTimeout);
                callback();
            } catch (e) {
                callback();
            }
        }
    });

    adapter = new utils.Adapter(options);

    return adapter;
}

function setConnected(_isConnected) {
    if (isConnected !== _isConnected) {
        isConnected = _isConnected;
        adapter.setState('info.connection', { val: isConnected, ack: true });
    }
}

function main() {
    if (adapter.config.ip && adapter.config.ip !== '0.0.0.0' && adapter.config.psk) {
        device = new Controller(adapter.config.ip, '80', adapter.config.psk, 5000);
        // in this template all states changes inside the adapters namespace are subscribed
        adapter.subscribeStates('*');
        checkStatus();

        statusInterval = setInterval(checkStatus, 10000); /* TODO: make this a config variable? */

        device.getInterfaceInformation().then(model => {
            adapter.setState('info.modelInformation', { val: model, ack: true });
        }).catch(err => {
            adapter.log.error(err);
        });

        createAvContentObjects();
        createAppObjects();
    } else {
        adapter.log.error("Please configure the Sony Bravia adapter");
    }
}

function turnOverIfPowerIsActiv(id, turnOverCall) {
    ifPowerIsActiv(() => {
        adapter.getObject(id, (err, obj) => {
            if (err) {
                adapter.log.error(err);
            } else {
                const uri = obj.native.uri;
                adapter.log.debug("Turn over to " + uri);
                turnOverCall(uri);
            }
        });
    })
}

function turnVolume(id, targetCall) {
    ifPowerIsActiv(() => {
        adapter.getObject(id, (err, obj) => {
            if (err) {
                adapter.log.error(err);
            } else {
                const target = obj.native.target;
                adapter.log.debug("Controll volumne " + target);
                targetCall(target);
            }
        });
    })
}

function ifPowerIsActiv(callback) {
    adapter.getState("info.powerStatusActive", (err, powerState) => {
        if (err) {
            adapter.log.error(err);
        } else {
            if (powerState.val) {
                callback();
            } else {
                adapter.log.info("Device have to turned on");
            }
        }
    });
}

const toSnakeCase = str =>
    str &&
    str.match(/[A-Z]{2,}(?=[A-Z][a-z]+[0-9]*|\b)|[A-Z]?[a-z]+[0-9]*|[A-Z]+|[0-9]+/g)
        .map(x => x.toLowerCase())
        .join('_');

function createAppObjects() {
    device.getApplicationList().then(apps => {
        if (Array.isArray(apps)) {
            apps.forEach(app => {
                if (app.title && app.title.length > 1) {
                    adapter.log.debug("Create App " + app.title + " at " + app.uri);
                    adapter.setObjectNotExists("appControl.app." + toSnakeCase(app.title), {
                        "type": "state",
                        "common": {
                            "name": app.title,
                            "role": "button",
                            "type": "boolean",
                            "read": false,
                            "write": true
                        },
                        native: {
                            "uri": app.uri
                        }
                    });
                }
            });
        } else {
            adapter.log.error("Application List. Unknown content response " + JSON.stringify(scheme));
        }
    }).catch(err => {
        adapter.log.error("ApplicationList " + err);
    });
}

function createAvContentObjects() {
    device.getSchemeList().then(scheme => {
        if (Array.isArray(scheme)) {
            scheme.forEach(schema => {
                device.getSourceList(schema.scheme).then(sources => {
                    if (Array.isArray(sources)) {
                        sources.forEach(source => {
                            /* TODO: make this a config variable? */
                            device.getContentList(0, 150, source.source).then(channels => {
                                if (Array.isArray(channels)) {
                                    channels.forEach(channel => {
                                        if (channel.title && channel.title.length > 1) {
                                            adapter.log.debug("Create " + schema.scheme + " AV Content " + channel.title + " at " + channel.uri);
                                            adapter.setObjectNotExists("avContent." + schema.scheme + "." + toSnakeCase(channel.title), {
                                                "type": "state",
                                                "common": {
                                                    "name": channel.title,
                                                    "role": "button",
                                                    "type": "boolean",
                                                    "read": false,
                                                    "write": true
                                                },
                                                native: {
                                                    "uri": channel.uri
                                                }
                                            });
                                        }
                                    });
                                } else {
                                    adapter.log.error("Content List. Unknown content response " + JSON.stringify(channels));
                                }
                            }).catch(err => {
                                adapter.log.error("ContentList " + err);
                            });
                        })
                    } else {
                        adapter.log.error("Source List. Unknown content response " + JSON.stringify(sources));
                    }
                }).catch(err => {
                    adapter.log.error("SourceList " + err);
                });
            });
        } else {
            adapter.log.error("Scheme List. Unknown content response " + JSON.stringify(scheme));
        }
    }).catch(err => {
        adapter.log.error("SchemeList " + err);
    });
}

function checkStatus() {
    ping.probe(adapter.config.ip, { log: adapter.log.debug }, function (err, result) {
        if (err) {
            adapter.log.info("ping cannot be executed " + err);
            setConnected(false);
        }
        if (result) {
            adapter.log.debug("Ping result: " + JSON.stringify(result));

            setConnected(result.alive);

            if (result.alive) {
                // Check other read only objects
                device.getPowerStatus().then(states => {
                    adapter.setState('info.powerStatusActive', { val: (states.result[0].status == 'active' ? true : false), ack: true });
                }).catch(err => {
                    adapter.setState('info.powerStatusActive', { val: false, ack: true });
                    adapter.log.info("powerStatus cannot be determined " + err);
                })

                device.getPlayingContentInfo().then(content => {
                    adapter.setState('info.playingContentInfo', { val: content, ack: true });
                }).catch(err => {
                    adapter.setState('info.playingContentInfo', { val: "", ack: true });
                    adapter.log.info("contentInfo cannot be determined " + err);
                });

                device.getVolumeInformation().then(setups => {
                    if (Array.isArray(setups)) {
                        setups.forEach(setup => {
                            if (Array.isArray(setup)) {
                                setup.forEach(audio => {
                                    if (audio.target && audio.target.length > 1) {
                                        adapter.setObjectNotExists("audio.volume." + toSnakeCase(audio.target), {
                                            "type": "channel",
                                            "common": {
                                                "name": audio.target
                                            },
                                            native: {}
                                        });
                                        adapter.setObjectNotExists("audio.volume." + toSnakeCase(audio.target) + ".volume", {
                                            "type": "state",
                                            "common": {
                                                "name": "Volumen",
                                                "role": "state",
                                                "type": "string",
                                                "read": true,
                                                "write": true
                                            },
                                            native: {
                                                "target": audio.target
                                            }
                                        });
                                        adapter.setState("audio.volume." + toSnakeCase(audio.target) + ".volume", { val: audio.volume.toString(), ack: true });
                                        adapter.setObjectNotExists("audio.volume." + toSnakeCase(audio.target) + ".mute", {
                                            "type": "state",
                                            "common": {
                                                "name": "Stumm",
                                                "role": "switch",
                                                "type": "boolean",
                                                "read": true,
                                                "write": true
                                            },
                                            native: {
                                                "target": audio.target
                                            }
                                        });
                                        adapter.setState("audio.volume." + toSnakeCase(audio.target) + ".mute", { val: audio.mute, ack: true });
                                    }
                                });
                            }
                        });
                    } else {
                        adapter.log.error("Volume Information. Unknown content response " + JSON.stringify(audios));
                    }
                }).catch(err => {
                    adapter.log.info("volumeInformation cannot be determined " + err);
                });
            } else {
                adapter.setState('info.powerStatusActive', { val: false, ack: true });
                adapter.setState('info.playingContentInfo', { val: "", ack: true });
            }
        }
    });
}

// If started as allInOne/compact mode => return function to create instance
if (module && module.parent) {
    module.exports = startAdapter;
} else {
    // or start the instance directly
    startAdapter();
}
