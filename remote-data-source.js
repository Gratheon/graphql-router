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
		headers.set('internal-router-signature', "a239vmwoeifworg"); // Consider making this more secure if needed

		// Forward appropriate context headers based on the revised plan
		let userIdForwarded = false;
		if (context?.userId) {
			headers.set('internal-userId', context.userId);
			console.log('Forwarding internal-userId header:', context.userId);
			userIdForwarded = true;
		}

		let scopesForwarded = false;
		if (context?.shareScopes) {
			try {
				// Ensure shareScopes is an object before stringifying
				if (typeof context.shareScopes === 'object' && context.shareScopes !== null) {
					headers.set('X-Share-Scopes', JSON.stringify(context.shareScopes));
					console.log('Forwarding X-Share-Scopes header');
					scopesForwarded = true;
				} else {
					console.error('Context shareScopes is not an object, cannot stringify:', context.shareScopes);
				}
			} catch (e) {
				console.error('Failed to stringify shareScopes:', e);
				// Decide how to handle error - maybe don't send header or throw?
			}
		}

		// Log if neither was forwarded (for debugging potential auth issues)
		if (!userIdForwarded && !scopesForwarded) {
			console.log('No userId or shareScopes in context to forward.');
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
