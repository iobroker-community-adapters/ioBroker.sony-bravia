/* jshint -W097 */// jshint strict:false
/*jslint node: true */
"use strict";

// you have to require the utils module and call adapter function
const utils = require('@iobroker/adapter-core'); // Get common adapter utils
const Controller = require(__dirname + '/lib/bravia');
const ping = require(__dirname + '/lib/ping');
const http = require('http');

let isConnected = null;
let device;

// you have to call the adapter function and pass a options object
// name has to be set and has to be equal to adapters folder name and main file name excluding extension
// adapter will be restarted automatically every time as the configuration changed, e.g system.adapter.template.0
let adapter, statusInterval;
function startAdapter(options) {
    options = options || {};
    Object.assign(options, {
        name: 'sony-bravia',
        stateChange: function (id, state) {
            if (id && state && !state.ack) {
                id = id.substring(id.lastIndexOf('.') + 1);
                device.send(id);
            }
        },
        ready: main,
        unload: (callback) => {
            try {
                statusInterval && clearInterval(statusInterval);
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
        adapter.setState('info.connection', {val: isConnected, ack: true});
    }
}

function main() {

    if (adapter.config.ip && adapter.config.ip !== '0.0.0.0' && adapter.config.psk) {
        device = new Controller(adapter.config.ip, '80', adapter.config.psk, 5000);
        // in this template all states changes inside the adapters namespace are subscribed
        adapter.subscribeStates('*');
        checkStatus();

        statusInterval = setInterval(checkStatus, 10000); /* TODO: make this a config variable? */

    } else {
        adapter.log.error("Please configure the Sony Bravia adapter");
    }

}

function checkStatus() {
    ping.probe(adapter.config.ip, {log: adapter.log.debug}, function (err, result) {
        if (err) {
            adapter.log.error(err);
        }
        if (result) {
            setConnected(result.alive);
        }
    });

    // Check other read only objects
    // TODO: This should probably be in it's own function
    const postData = JSON.stringify({
        'method' : 'getPowerStatus',
        'params' : [''],
        'id' : 1,
        'version' : '1.0'
    });

    const options = {
        host: adapter.config.ip,
        port: '80',
        path: '/sony/system',
        method: 'POST',
        headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            'Content-Length': postData.length
        }
    };

    const postReq = http.request(options, function(postRes){
        let body = '';
        postRes.on('data', function(data){
            body += data;
        });

        postRes.on('end', function(){
            try {
                let states = JSON.parse(body);
                adapter.setState('info.powerStatusActive', {val: (states.result[0].status == 'active' ? true : false), ack: true});
            } catch (err) {
                console.error(err);
            }
        });
    });

    postReq.on('error', (err) => {
        console.error(err);
    });

    postReq.write(postData);
    postReq.end();
}

// If started as allInOne/compact mode => return function to create instance
if (module && module.parent) {
    module.exports = startAdapter;
} else {
    // or start the instance directly
    startAdapter();
}
