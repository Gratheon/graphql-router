import assert from 'node:assert/strict';
import test from 'node:test';

function loadConfig(env: NodeJS.ProcessEnv) {
    const previousEnv = process.env;
    process.env = env;
    const modulePath = require.resolve('./config.default');
    delete require.cache[modulePath];

    try {
        return require('./config.default').default;
    } finally {
        process.env = previousEnv;
        delete require.cache[modulePath];
    }
}

test('uses localhost service endpoints with production host networking', () => {
    const config = loadConfig({ENV_ID: 'prod'});

    assert.equal(config.schemaRegistryUrl, 'http://127.0.0.1:3000');
    assert.equal(config.userCycleUrl, 'http://127.0.0.1:4000');
});

test('keeps Docker DNS endpoints for development', () => {
    const config = loadConfig({ENV_ID: 'dev'});

    assert.equal(config.schemaRegistryUrl, 'http://gql-schema-registry:3000');
    assert.equal(config.userCycleUrl, 'http://user-cycle:4000');
});

test('allows service endpoints to be overridden', () => {
    const config = loadConfig({
        ENV_ID: 'prod',
        SCHEMA_REGISTRY_URL: 'http://schema-registry.internal:3000',
        USER_CYCLE_URL: 'http://user-cycle.internal:4000',
    });

    assert.equal(config.schemaRegistryUrl, 'http://schema-registry.internal:3000');
    assert.equal(config.userCycleUrl, 'http://user-cycle.internal:4000');
});
