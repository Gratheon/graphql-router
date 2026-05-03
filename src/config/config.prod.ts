export default {
	redisHost: process.env.REDIS_HOST || '127.0.0.1',
	redisPort: parseInt(process.env.REDIS_PORT || '6379', 10),
	redisSecret: process.env.REDIS_SECRET || process.env.REDIS_PASSWORD || 'pass',
	schemaRegistryUrl: process.env.SCHEMA_REGISTRY_URL || 'http://127.0.0.1:3000',
	userCycleUrl: process.env.USER_CYCLE_URL || 'http://127.0.0.1:4000',
};
