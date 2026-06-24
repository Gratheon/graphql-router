export default {
	sentryDsn: "https://1e0b26de5f1c410caf637382e4f7c8b8@o4504323550216192.ingest.sentry.io/4505513278308352",
	redisHost: process.env.REDIS_HOST || 'redis',
	redisPort: parseInt(process.env.REDIS_PORT || '6379', 10),
	redisSecret: process.env.REDIS_SECRET || '',
	schemaRegistryUrl: 'http://gql-schema-registry:3000',
	userCycleUrl: 'http://user-cycle:4000',
	altairEndpointUrl: process.env.ALTAIR_ENDPOINT_URL || 'http://localhost:6100/graphql',

	// thist must match user-cycle JWT_KEY
	privateKey: 'okzfERFAXXbRTQWkGFfjo3EcAXjRijnGnaAMEsTXnmdjAVDkQrfyLzscPwUiymbj',
};
