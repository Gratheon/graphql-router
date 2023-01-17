const { get } = require('lodash');
const request = require('request-promise-native');
const config = require('./config');

exports.getServiceListWithTypeDefs = async (serviceSdlCache) => {
	const baseUrl = config.schemaRegistryUrl;

	let schemaChanged = false;
	const serviceTypeDefinitions = await request({
		baseUrl,
		method: 'GET',

		// Better approach to provide versions of services you have running in production
		// instead of using just /schema/latest
		url: '/schema/latest',
		json: true,
	});

	const services = get(serviceTypeDefinitions, 'data', []).map((schema) => {
		if (!schema.url) {
			console.warn(
				`Service url not found for type definition "${schema.name}"`
			);
		} else {
			console.log(
				`Got ${schema.name} service schema with version ${schema.version}`
			);
		}

		const previousDefinition = serviceSdlCache.get(schema.name);
		if (schema.type_defs !== previousDefinition) {
			schemaChanged = true;
		}

		serviceSdlCache.set(schema.name, schema.type_defs);

		return {
			name: schema.name,
			// note that URLs are used based on service name, utilizing docker internal network
			url: `http://${schema.url}`,
			version: schema.version,
			typeDefs: schema.type_defs,
			typeDefsOriginal: schema.type_defs_original
		};
	});

	return { services, schemaChanged };
};
