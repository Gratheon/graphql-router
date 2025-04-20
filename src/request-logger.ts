import { Kafka, Producer, KafkaConfig, Message } from 'kafkajs';
import { ApolloServerPlugin, GraphQLRequestListener } from 'apollo-server-plugin-base';
import { GraphQLRequestContext } from 'apollo-server-types';
import config from './config';
import { MyContext } from './graphql-router'; // Import context type if needed

// Define the structure of the event payload sent to Kafka
interface KafkaEventPayload {
    query?: string;
    operationName?: string | null;
    persistedQueryHash?: string;
    headers?: Record<string, string | string[] | undefined>; // Match IncomingHttpHeaders
}

// Define the structure for the request logger object
interface RequestLogger {
    connectToKafka: () => Promise<void>;
    register: () => ApolloServerPlugin<MyContext>; // Use MyContext if context is accessed
}

let producer: Producer | undefined;

const requestLogger: RequestLogger = {
    connectToKafka: async (): Promise<void> => {
        try {
            console.info('Connecting to kafka broker:', config.kafkaBrokerUrl);

            const kafkaConfig: KafkaConfig = {
                clientId: 'graphql-router-service', // More specific client ID
                brokers: [config.kafkaBrokerUrl],
                // Add any other necessary Kafka configurations (e.g., SSL, SASL)
            };
            const kafka = new Kafka(kafkaConfig);

            producer = kafka.producer({
                // Add producer configurations if needed (e.g., idempotent, retries)
            });

            // Handle producer events for better resilience
            producer.on('producer.connect', () => console.log('Kafka Producer connected'));
            producer.on('producer.disconnect', (event) => console.error('Kafka Producer disconnected', event));
            // Consider adding 'producer.network.request_timeout' or other error handlers

            await producer.connect();
        } catch (e: any) {
            console.error('Failed to connect Kafka producer:', e instanceof Error ? e.message : String(e));
            // Reset producer on failure to allow retry on next request
            producer = undefined;
        }
    },

    register: (): ApolloServerPlugin<MyContext> => ({
        // This hook runs for each request
        async requestDidStart(
            requestContext: GraphQLRequestContext<MyContext>
        ): Promise<GraphQLRequestListener<MyContext> | void> { // Return type can be void or listener

            // Ensure producer is connected, attempt connection if not
            if (!producer) {
                console.warn('Kafka producer not connected, attempting to connect...');
                await requestLogger.connectToKafka();
                if (!producer) {
                    console.error('Kafka producer connection failed, cannot log query for this request.');
                    return; // Stop processing if connection fails
                }
            }

            // Use a specific producer instance for this request to avoid race conditions if connectToKafka runs concurrently
            const currentProducer = producer;

            // Return listener hooks if needed, e.g., willSendResponse
            // For just logging the start, we can do it directly here.

            try {
                const eventPayload: KafkaEventPayload = {
                    query: requestContext.request.query,
                    operationName: requestContext.request.operationName,
                    persistedQueryHash: requestContext.request.extensions?.persistedQuery?.sha256Hash, // Access specific hash if available
                };

                // Safely access headers
                if (requestContext.request.http?.headers) {
                    // Last attempt: Treat as a plain object and iterate keys (less safe)
                    eventPayload.headers = {};
                    const headerObj = requestContext.request.http.headers;
                    try {
                        // Check if it's iterable or has keys we can access
                        if (typeof headerObj === 'object' && headerObj !== null) {
                             for (const key in headerObj) {
                                 // Ensure we are accessing own properties if necessary, though Headers objects usually don't have inherited properties
                                 if (Object.prototype.hasOwnProperty.call(headerObj, key)) {
                                     // Accessing potentially non-standard properties
                                     eventPayload.headers[key] = (headerObj as any)[key];
                                 }
                             }
                        } else {
                             console.warn("Headers object is not an object or is null.");
                        }
                    } catch (e) {
                         console.warn("Failed to iterate over headers object keys.", e);
                         eventPayload.headers = undefined; // Fallback on error
                    }
                }

                console.log('Sending message to kafka:', eventPayload);

                const message: Message = {
                    // key: // Optional: Add a key for partitioning (e.g., user ID, operation name)
                    value: JSON.stringify(eventPayload),
                    // headers: {} // Add Kafka message headers if needed
                };

                await currentProducer.send({
                    topic: 'graphql-queries', // Consider making topic configurable
                    messages: [message],
                    // acks: // Configure acknowledgements (e.g., 1, -1)
                    // timeout: // Configure request timeout
                });
            } catch (e: any) {
                console.error('Failed to send message to Kafka:', e instanceof Error ? e.message : String(e));
                // Optional: Handle specific Kafka errors (e.g., disconnect, retries)
            }

            // No need to return a listener if only logging at the start
        },
    }),
};

// Export the logger object
export default requestLogger;
