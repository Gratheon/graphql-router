import Redis from 'ioredis';
import { ApolloServerPlugin, GraphQLRequestListener } from 'apollo-server-plugin-base';
import { GraphQLRequestContext } from 'apollo-server-types';
import config, { get } from './config';
import { MyContext } from './graphql-router'; // Import context type if needed

// Define the structure of the event payload sent to Kafka
interface KafkaEventPayload {
    query?: string;
    operationName?: string | null;
    persistedQueryHash?: string;
    timestamp?: number;
    headers?: Record<string, string | string[] | undefined>; // Match IncomingHttpHeaders
}

// Define the structure for the request logger object
interface RequestLogger {
    connectToRedis: () => Promise<void>;
    register: () => ApolloServerPlugin<MyContext>; // Use MyContext if context is accessed
}

let publisher: Redis | undefined;
const queriesChannel = process.env.REDIS_QUERIES_CHANNEL || 'graphql-queries';

function serializeHeaders(
    headers: unknown
): Record<string, string | string[] | undefined> {
    const serialized: Record<string, string | string[] | undefined> = {};

    if (!headers) {
        return serialized;
    }

    // Apollo HeaderMap / Fetch Headers style
    if (typeof (headers as any).forEach === 'function') {
        (headers as any).forEach((value: unknown, key: string) => {
            serialized[String(key).toLowerCase()] =
                Array.isArray(value) ? value.map(String) : String(value);
        });
        return serialized;
    }

    // Generic iterable of [key, value]
    if (typeof (headers as any)[Symbol.iterator] === 'function') {
        for (const entry of headers as Iterable<unknown>) {
            if (Array.isArray(entry) && entry.length >= 2) {
                const [key, value] = entry as [unknown, unknown];
                serialized[String(key).toLowerCase()] =
                    Array.isArray(value) ? value.map(String) : String(value);
            }
        }
        return serialized;
    }

    // Plain object fallback
    for (const [key, value] of Object.entries(headers as Record<string, unknown>)) {
        serialized[key.toLowerCase()] = Array.isArray(value)
            ? value.map(String)
            : (value as string | undefined);
    }

    return serialized;
}

const requestLogger: RequestLogger = {
    connectToRedis: async (): Promise<void> => {
        try {
            if (publisher && (publisher.status === 'ready' || publisher.status === 'connecting')) {
                return;
            }

            console.info('Connecting to redis:', config.redisHost, config.redisPort);
            publisher = new Redis({
                host: get('redisHost'),
                port: get('redisPort'),
                password: get('redisSecret') || undefined,
                lazyConnect: true,
                maxRetriesPerRequest: 1,
            });
            publisher.on('error', (error) => {
                console.error('Redis publisher error:', error instanceof Error ? error.message : String(error));
            });
            await publisher.connect();
        } catch (e: any) {
            console.error('Failed to connect Redis publisher:', e instanceof Error ? e.message : String(e));
            publisher = undefined;
        }
    },

    register: (): ApolloServerPlugin<MyContext> => ({
        // This hook runs for each request
        async requestDidStart(
            requestContext: GraphQLRequestContext<MyContext>
        ): Promise<GraphQLRequestListener<MyContext> | void> { // Return type can be void or listener

            // Ensure publisher is connected, attempt connection if not
            if (!publisher) {
                console.warn('Redis publisher not connected, attempting to connect...');
                await requestLogger.connectToRedis();
                if (!publisher) {
                    console.error('Redis publisher connection failed, cannot log query for this request.');
                    return; // Stop processing if connection fails
                }
            }

            const currentPublisher = publisher;

            // Return listener hooks if needed, e.g., willSendResponse
            // For just logging the start, we can do it directly here.

            try {
                const eventPayload: KafkaEventPayload = {
                    query: requestContext.request.query,
                    operationName: requestContext.request.operationName,
                    persistedQueryHash: requestContext.request.extensions?.persistedQuery?.sha256Hash, // Access specific hash if available
                    timestamp: Date.now(),
                };

                // Safely access headers
                if (requestContext.request.http?.headers) {
                    eventPayload.headers = serializeHeaders(
                        requestContext.request.http.headers
                    );

                    // Normalize common custom header names into Apollo's expected names.
                    if (
                        !eventPayload.headers['apollographql-client-name'] &&
                        eventPayload.headers['x-client-name']
                    ) {
                        eventPayload.headers['apollographql-client-name'] =
                            eventPayload.headers['x-client-name'];
                    }
                    if (
                        !eventPayload.headers['apollographql-client-version'] &&
                        eventPayload.headers['x-client-version']
                    ) {
                        eventPayload.headers['apollographql-client-version'] =
                            eventPayload.headers['x-client-version'];
                    }
                }

                console.log('Publishing query event to redis:', eventPayload);

                await currentPublisher.publish(queriesChannel, JSON.stringify(eventPayload));
            } catch (e: any) {
                console.error('Failed to publish query event to Redis:', e instanceof Error ? e.message : String(e));
            }

            // No need to return a listener if only logging at the start
        },
    }),
};

// Export the logger object
export default requestLogger;
