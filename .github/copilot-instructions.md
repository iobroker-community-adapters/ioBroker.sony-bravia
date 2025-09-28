# ioBroker Adapter Development with GitHub Copilot

**Version:** 0.4.0
**Template Source:** https://github.com/DrozmotiX/ioBroker-Copilot-Instructions

This file contains instructions and best practices for GitHub Copilot when working on ioBroker adapter development.

## Project Context

You are working on an ioBroker adapter. ioBroker is an integration platform for the Internet of Things, focused on building smart home and industrial IoT solutions. Adapters are plugins that connect ioBroker to external systems, devices, or services.

### Sony Bravia Adapter Specific Context
- **Adapter Name:** sony-bravia
- **Primary Function:** Controls Sony Bravia Smart TVs with Android OS via network protocol
- **Key Dependencies:** SSDP discovery service, HTTP API communication, XML parsing for device info
- **Target Devices:** Sony Bravia Android Smart TVs (tested with KD-65X8507C)
- **Configuration Requirements:** TV IP address, Pre-Shared Key (PSK) for authentication
- **Communication Protocol:** HTTP requests to Sony TV's REST API endpoints
- **Device Discovery:** SSDP (Simple Service Discovery Protocol) for automatic TV detection
- **Remote Control:** IRCC (Infrared Compatible Control Code) commands for TV operations

## Testing

### Unit Testing
- Use Jest as the primary testing framework for ioBroker adapters
- Test files should be placed in the `test/` directory
- Name test files with `.test.js` extension
- Use the `@iobroker/testing` package for adapter-specific testing utilities

### Integration Testing
- Test actual adapter startup and shutdown scenarios
- Verify state creation and management
- Test configuration validation and error handling
- Use `mocha` for integration tests as configured in `package.json`

### Sony Bravia Specific Testing Patterns
```javascript
// Example: Test SSDP device discovery
describe('SSDP Discovery', () => {
    it('should discover Sony Bravia devices on network', async () => {
        // Mock SSDP response with Sony device information
        const mockDevice = {
            LOCATION: 'http://192.168.1.100:52323/dmr.xml',
            USN: 'uuid:sony-tv-device-id'
        };
        // Test discovery logic
    });
});

// Example: Test IRCC command sending
describe('IRCC Commands', () => {
    it('should send power on command successfully', async () => {
        const powerCommand = 'AAAAAQAAAAEAAAAuAw==';
        // Test command execution with proper error handling
    });
});
```

## Architecture

### Standard ioBroker Adapter Structure
```
your-adapter/
├── admin/           # Admin interface files
├── lib/            # Library files
├── main.js         # Main adapter file
├── io-package.json # Adapter configuration
└── package.json    # Node.js package configuration
```

### Sony Bravia Adapter Structure
```
sony-bravia/
├── admin/           # Admin interface and translations
├── lib/
│   ├── bravia.js   # Main Sony TV communication library
│   ├── ping.js     # Network connectivity testing
│   ├── tools.js    # Utility functions
│   └── service-protocol.js # SSDP service discovery
├── main.js         # Adapter entry point
├── io-package.json # Adapter metadata and state definitions
└── package.json    # Dependencies: node-ssdp, request, xml2js
```

## Development Guidelines

### General ioBroker Best Practices
- Always use `this.log.debug()`, `this.log.info()`, `this.log.warn()`, and `this.log.error()` for logging
- Implement proper error handling and recovery mechanisms
- Clean up resources and timers in the `unload()` method
- Use `this.setState()` and `this.getState()` for state management
- Follow semantic versioning in `package.json` and `io-package.json`

### Sony Bravia Specific Patterns
- **Device Discovery:** Implement SSDP discovery with proper timeout handling
- **Authentication:** Use PSK (Pre-Shared Key) authentication for secure communication
- **Command Structure:** IRCC commands are base64-encoded - decode/validate before sending
- **Error Handling:** TV may be offline/unreachable - implement retry logic with exponential backoff
- **State Management:** Create hierarchical state structure (info, channel, audio, appControl, etc.)

```javascript
// Example: Proper SSDP discovery implementation
const ssdp = new SSDP();
const discovered = [];

ssdp.on('response', (headers, statusCode, info) => {
    if (headers.LOCATION && headers.LOCATION.includes('sony') && headers.SERVER) {
        const device = {
            ip: info.address,
            location: headers.LOCATION,
            server: headers.SERVER
        };
        discovered.push(device);
    }
});

// Example: IRCC command with proper error handling
async sendCommand(command) {
    try {
        const response = await this.sendSoapRequest('IRCC', command);
        if (response.statusCode !== 200) {
            this.log.warn(`Command failed with status: ${response.statusCode}`);
        }
    } catch (error) {
        this.log.error(`Failed to send command: ${error.message}`);
        throw error;
    }
}
```

### State Management Patterns
```javascript
// Create states with proper structure and types
await this.setObjectNotExistsAsync('info.connection', {
    type: 'state',
    common: {
        name: 'If connected to TV',
        type: 'boolean',
        role: 'indicator.connected',
        read: true,
        write: false
    },
    native: {}
});

// Update states with proper error handling
try {
    await this.setStateAsync('info.connection', { val: true, ack: true });
} catch (error) {
    this.log.error(`Failed to update connection state: ${error.message}`);
}
```

## Code Style

### ESLint Configuration
- Follow the existing `.eslintrc.json` configuration
- Use single quotes for strings
- Prefer `const` over `let` when variables are not reassigned
- Use semicolons at the end of statements
- Handle unused variables by prefixing with underscore `_unused`

### Sony Bravia Specific Code Standards
- Keep TV communication methods in `lib/bravia.js`
- Use descriptive names for IRCC command mappings
- Implement proper XML parsing for device information
- Use async/await patterns for network operations
- Include timeout handling for all HTTP requests

## Common Patterns

### Adapter Initialization
```javascript
class SonyBravia extends utils.Adapter {
    constructor(options = {}) {
        super({
            ...options,
            name: 'sony-bravia',
        });
        this.on('ready', this.onReady.bind(this));
        this.on('stateChange', this.onStateChange.bind(this));
        this.on('unload', this.onUnload.bind(this));
    }

    async onReady() {
        // Initialize TV connection
        // Set up state listeners
        // Start discovery process
    }
}
```

### Configuration Handling
```javascript
// Validate required configuration
if (!this.config.ip || !this.config.psk) {
    this.log.error('IP address and PSK are required for TV connection');
    return;
}

// Test TV connectivity before proceeding
const isReachable = await this.testConnection(this.config.ip);
if (!isReachable) {
    this.log.warn(`TV at ${this.config.ip} is not reachable`);
}
```

### Network Communication Error Handling
```javascript
// Implement retry logic for TV communication
async makeRequest(url, options, retries = 3) {
    for (let attempt = 1; attempt <= retries; attempt++) {
        try {
            const response = await request(url, options);
            return response;
        } catch (error) {
            this.log.debug(`Request attempt ${attempt} failed: ${error.message}`);
            if (attempt === retries) throw error;
            await this.wait(1000 * attempt); // Exponential backoff
        }
    }
}
```

## Security Considerations

### Network Security
- Always validate TV IP addresses and prevent access to local network resources
- Use secure PSK authentication - never log PSK values
- Implement proper timeout handling to prevent resource exhaustion
- Validate all incoming TV responses before processing

### Data Validation
```javascript
// Validate TV responses before processing
validateTvResponse(response) {
    if (!response || typeof response !== 'object') {
        throw new Error('Invalid TV response format');
    }
    if (response.error) {
        throw new Error(`TV Error: ${response.error.message}`);
    }
    return response;
}
```

## Troubleshooting Common Issues

### TV Connection Problems
- Verify TV is powered on and network settings are configured
- Check IP Control and Remote device settings are enabled
- Validate PSK matches between adapter and TV configuration
- Test network connectivity using ping functionality

### State Creation Issues
- Ensure proper object structure in `io-package.json`
- Use `setObjectNotExistsAsync` for dynamic state creation
- Validate state values before setting (type checking)

### SSDP Discovery Issues
- Check network firewall settings for UDP multicast
- Verify TV supports SSDP announcement
- Implement proper timeout handling for discovery process

## Performance Optimization

### Efficient State Updates
- Batch related state updates when possible
- Use `ack: true` for states updated from TV
- Implement debouncing for frequent state changes

### Network Optimization
- Reuse HTTP connections where possible
- Implement proper connection pooling
- Cache TV capabilities to reduce API calls

## Logging Best Practices

### Sony Bravia Logging Guidelines
```javascript
// Use appropriate log levels
this.log.debug(`Sending IRCC command: ${commandName}`);
this.log.info(`Connected to Sony TV at ${this.config.ip}`);
this.log.warn(`TV response delayed, retrying connection`);
this.log.error(`Failed to authenticate with TV: Invalid PSK`);

// Never log sensitive information
this.log.debug(`Authenticating with TV using PSK: ${'*'.repeat(4)}`);
```

### Structured Logging
```javascript
// Include context in log messages
this.log.info(`TV Discovery completed: Found ${devices.length} Sony devices`);
this.log.debug(`Processing TV response for state: ${stateId}, value: ${value}`);
```

This comprehensive guide should help GitHub Copilot provide more accurate and contextual suggestions when working on the Sony Bravia adapter for ioBroker.