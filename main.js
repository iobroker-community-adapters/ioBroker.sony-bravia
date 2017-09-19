/* jshint -W097 */// jshint strict:false
/*jslint node: true */
"use strict";

var Controller = require('bravia');
var ping = require("ping");

// you have to require the utils module and call adapter function
var utils =    require(__dirname + '/lib/utils'); // Get common adapter utils

// you have to call the adapter function and pass a options object
// name has to be set and has to be equal to adapters folder name and main file name excluding extension
// adapter will be restarted automatically every time as the configuration changed, e.g system.adapter.template.0
var adapter = utils.adapter('sony-bravia');

var isConnected = null;
var device;

// is called if a subscribed state changes
adapter.on('stateChange', function (id, state) {    
    if (id && state && !state.ack){
	id = id.substring(adapter.namespace.length + 1);
	device.send(id);
    }
});

// is called when databases are connected and adapter received configuration.
// start here!
adapter.on('ready', main);

function setConnected(_isConnected) {
    if (isConnected !== _isConnected) {
        isConnected = _isConnected;
        adapter.setState('info.connection', {val: isConnected, ack: true});
    }
}

function main() {

    if(adapter.config.ip && adapter.config.ip !== '0.0.0.0' && adapter.config.psk) {
        device = new Controller(adapter.config.ip, '80', adapter.config.psk);
        // in this template all states changes inside the adapters namespace are subscribed
        adapter.subscribeStates('*');
        checkStatus();
        
        setInterval(checkStatus, 60000);

    } else {
        adapter.log.error("Please configure the Sony Bravia adapter");
    }

}

function checkStatus() {
    ping.sys.probe(adapter.config.ip, function (isAlive) {
        setConnected(isAlive);
    });
}