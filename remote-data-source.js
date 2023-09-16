const { fetch, Request, Headers } = require('apollo-server-env');

class RemoteGraphQLDataSource {
	constructor(apolloServer, config) {
		this.gateway = apolloServer.gateway;

		if (config) {
			return Object.assign(this, config);
		}
	}

	async process({ request, context = {} }) {
		// use service discovery (etcd, consul) to dynamically update addresses of services
		const url = `${this.url.replace('dynamic://','http://')}/graphql`;

		const headers = (request.http && request.http.headers) || new Headers();


		headers.set('Content-Type', 'application/json');
		headers.set('internal-router-signature', "a239vmwoeifworg");

		if(context?.userId){
			headers.set('internal-userId', context?.userId);
		}
		
		request.http = {
			method: 'POST',
			url,
			headers,
		};
		const { http, ...graphqlRequest } = request;
		const options = {
			...http,
			body: JSON.stringify(graphqlRequest),
		};

		const httpRequest = new Request(request.http.url, options);
		const httpResponse = await fetch(httpRequest);

		// console.log('httpResponse', httpResponse);
		const body = await httpResponse.json();

		return {
			...body,
			http: httpResponse,
		};
	}
}

module.exports = RemoteGraphQLDataSource;
