import { fetch, Request as ApolloRequest, Headers } from 'apollo-server-env';
import { GraphQLRequest, GraphQLResponse } from 'apollo-server-types';
import { ServiceEndpointDefinition } from '@apollo/gateway';
import { MyContext } from './graphql-router'; // Import context type
import {logger} from './logger'; // Import logger

// Standalone class, not extending ApolloRemoteGraphQLDataSource
export default class RemoteGraphQLDataSource {
    private url?: string;
    private name?: string;

    // Constructor takes the service definition provided by Apollo Gateway
    constructor(service: ServiceEndpointDefinition) {
        this.url = service.url;
        this.name = service.name;
    }

    // Implement the process method to handle the request lifecycle
    async process({ request, context }: { request: GraphQLRequest; context?: MyContext }): Promise<GraphQLResponse> {
        // Log the received context argument
        logger.log(`[REMOTE_DATASOURCE] Service '${this.name}': Received context ARGUMENT in process():`, JSON.stringify(context));

        // Attempt to access context potentially attached to the request object itself (less reliable)
        const requestContext = (request as any).context as MyContext | undefined;
        logger.log(`[REMOTE_DATASOURCE] Service '${this.name}': Context found ON REQUEST object:`, JSON.stringify(requestContext));

        // Use the context found on the request object if available, otherwise fallback to the argument
        // **NOTE:** Based on logs, 'context' argument is likely empty/undefined here in the current setup.
        const effectiveContext = requestContext ?? context;
        logger.log(`[REMOTE_DATASOURCE] Service '${this.name}': Effective context being used:`, JSON.stringify(effectiveContext));


        if (!this.url) {
            throw new Error(`Datasource ${this.name ?? 'Unnamed'} does not have a URL defined`);
        }
        const targetUrl = `${this.url.replace('dynamic://', 'http://')}/graphql`;

        const headers = new Headers();
        headers.set('Content-Type', 'application/json');
        headers.set('internal-router-signature', "a239vmwoeifworg");

        // Forward context headers using the effectiveContext
        let userIdForwarded = false;
        if (effectiveContext?.userId) {
            headers.set('internal-userId', effectiveContext.userId);
            logger.log('[REMOTE_DATASOURCE] Forwarding internal-userId header:', effectiveContext.userId);
            userIdForwarded = true;
        } else {
             logger.log('[REMOTE_DATASOURCE] No userId found in effective context.');
        }

        // ShareScopes forwarding (removed for brevity in example, add back if needed)
        // ...

        if (!userIdForwarded /* && !scopesForwarded */) {
            logger.log('[REMOTE_DATASOURCE] No userId or shareScopes in effective context to forward.');
        }

        const { http, ...graphqlRequest } = request;
        const body = JSON.stringify(graphqlRequest);

        const httpRequest = new ApolloRequest(targetUrl, {
            method: 'POST',
            headers,
            body,
        });

        logger.log(`[REMOTE_DATASOURCE] Sending request to ${targetUrl} for service ${this.name}. Headers will include signature and potentially internal-userId.`);
        // Logging actual headers might still be problematic, log specific ones if needed:
        logger.log(`[REMOTE_DATASOURCE] Forwarding internal-userId: ${headers.get('internal-userId') ?? 'Not Set'}`);


        try {
            const httpResponse = await fetch(httpRequest);

            if (!httpResponse.ok) {
                 let errorBody = '';
                 try { errorBody = await httpResponse.text(); } catch (e) { /* Ignore */ }
                 logger.error(`Downstream service ${this.name} request failed with status ${httpResponse.status}: ${errorBody}`);
                 throw new Error(`Downstream service ${this.name} responded with status ${httpResponse.status}`);
            }

            const responseBody = await httpResponse.json();

            if (responseBody.errors) {
                 logger.error(`Errors from downstream service ${this.name}:`, JSON.stringify(responseBody.errors, null, 2));
            }

            return {
                data: responseBody.data,
                errors: responseBody.errors,
                extensions: responseBody.extensions,
            };
        } catch (error: any) {
            logger.error(`Failed to fetch or process response from downstream service ${this.name}:`, error instanceof Error ? error.message : String(error));
            throw error;
        }
    }
}
