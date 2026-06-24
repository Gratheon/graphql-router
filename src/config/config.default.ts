export default {
	sentryDsn: "https://1e0b26de5f1c410caf637382e4f7c8b8@o4504323550216192.ingest.sentry.io/4505513278308352",
	redisHost: process.env.REDIS_HOST || (process.env.ENV_ID === 'prod' ? '127.0.0.1' : 'redis'),
	redisPort: parseInt(process.env.REDIS_PORT || '6379', 10),
	redisSecret: process.env.REDIS_SECRET || process.env.REDIS_PASSWORD || '',
	schemaRegistryUrl: 'http://gql-schema-registry:3000',
	userCycleUrl: 'http://user-cycle:4000',
	altairEndpointUrl: process.env.ALTAIR_ENDPOINT_URL || 'https://graphql.gratheon.com/graphql',

	// thist must match user-cycle JWT_KEY
	privateKey: 'okzfERFAXXbRTQWkGFfjo3EcAXjRijnGnaAMEsTXnmdjAVDkQrfyLzscPwUiymbj',
};
