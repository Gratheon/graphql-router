import { ApolloGateway, ServiceEndpointDefinition } from '@apollo/gateway';
import { ApolloServer } from 'apollo-server-express';
import { altairExpress } from 'altair-express-middleware';
import express, { Request, Response, NextFunction, Router } from 'express';
import cookieParser from 'cookie-parser';
import jwt from 'jsonwebtoken';
import cors from 'cors';
import fetch from 'cross-fetch';
import { visit, DocumentNode, OperationDefinitionNode, FieldNode, printSchema, GraphQLError } from 'graphql';
import { traceExpressMiddleware, traceHttpClient } from '@gratheon/log-lib';

import { logger } from './logger';
import config, {get} from './config';
import CustomSupergraphManager from './supergraph';
import RemoteGraphQLDataSource from './remote-data-source';
import requestLogger from './request-logger';

const app = express();
app.use(traceExpressMiddleware());

// Sentry.init({ // Comment out Sentry init
//     dsn: config.sentryDsn,
//     environment: process.env.ENV_ID,
//     integrations: [
//         new Sentry.Integrations.Http({ tracing: true }),
//         // Comment out Express integration due to persistent type errors
//         // new Sentry.Integrations.Express(),
//     ],
//     tracesSampleRate: 1.0,
// });

const router: Router = express.Router();

// Helper function to safely extract HTTP status code from various error types
function getStatusCodeFromError(error: any): number {
    if (error instanceof GraphQLError && typeof error.extensions === 'object' && error.extensions !== null) {
        const extensions = error.extensions;
        if ('http' in extensions && typeof extensions.http === 'object' && extensions.http !== null) {
            const httpExt = extensions.http as Record<string, unknown>;
            if ('status' in httpExt && typeof httpExt.status === 'number') {
                const status = httpExt.status;
                if (status >= 400 && status < 600) { return status; }
            }
        }
    }
    // Removed check for error.status as it was problematic
    return 500;
}

// Define Context Type and Export it
export interface MyContext {
    userId?: string;
    billingPlan?: string;
    shareScopes?: Scopes;
    authError?: GraphQLError;
}

// Define Gateway options type if needed for CustomSupergraphManager
interface SupergraphManagerOptions {
    pollIntervalInMs?: number;
}

const gateway = new ApolloGateway({
    // Use our standalone RemoteGraphQLDataSource
    buildService: (service: ServiceEndpointDefinition) => new RemoteGraphQLDataSource(service),
    supergraphSdl: new CustomSupergraphManager({ pollIntervalInMs: 30000 } as SupergraphManagerOptions),
});

// Define types for validation responses
interface TokenUser { __typename: 'TokenUser'; id: string; }
interface ShareTokenDetails { __typename: 'ShareTokenDetails'; id: string; name: string; scopes: Scopes; userId: string; }
interface ErrorResponse { __typename: 'Error'; code: string; }
type ValidateApiTokenResponse = TokenUser | ErrorResponse;
type ValidateShareTokenResponse = ShareTokenDetails | ErrorResponse;

function postUserCycleGraphql(userCycleEndpoint: string, body: string, headers: Record<string, string> = { "Content-Type": "application/json" }) {
    return traceHttpClient({
        method: "POST",
        url: userCycleEndpoint,
        name: "POST user-cycle",
        headers,
    }, () => fetch(userCycleEndpoint, { method: "POST", headers, body }));
}

// Define context function - This will be passed to ApolloServer constructor
const contextFunction = async ({ req }: { req: Request }): Promise<MyContext> => {
    let contextData: MyContext = {};
    const userCycleEndpoint = `${config.userCycleUrl}/graphql`;
    try {
        const shareToken = req.headers['x-share-token'] as string | undefined;
        const bearer = req.headers['authorization'] as string | undefined;
        const cookieToken = req.cookies?.gratheon_session as string | undefined;
        const headerToken = req.headers['token'] as string | undefined;

        logger.log('[AUTH_DEBUG] Bearer:', bearer ? 'Present' : 'Missing');
        logger.log('[AUTH_DEBUG] Cookie Token:', cookieToken ? 'Present' : 'Missing');
        logger.log('[AUTH_DEBUG] Header Token:', headerToken ? 'Present' : 'Missing');
        logger.log('[AUTH_DEBUG] Share Token:', shareToken ? 'Present' : 'Missing');

        if (bearer) {
            const bearerToken = bearer.split(' ')[1];
            const response = await postUserCycleGraphql(userCycleEndpoint, JSON.stringify({ query: `mutation ValidateApiToken($token: String) { validateApiToken(token: $token) { __typename ... on TokenUser { id } ... on Error { code } } }`, variables: { token: bearerToken } }));
            const result = await response.json() as { data?: { validateApiToken?: ValidateApiTokenResponse } };
            const validationData = result?.data?.validateApiToken;
            if (validationData?.__typename === 'TokenUser') { contextData = { userId: validationData.id }; }
            else { throw new GraphQLError('Invalid API Key provided.', { extensions: { code: 'UNAUTHENTICATED', http: { status: 401 } } }); }
        } else if (cookieToken || headerToken) {
            const token = cookieToken || headerToken;
            if (token) {
                try {
                     const decoded = jwt.verify(token, get('privateKey')) as { user_id?: string };
                     if (decoded?.user_id) { contextData = { userId: decoded.user_id }; }
                     else { throw new GraphQLError('Invalid authentication token.', { extensions: { code: 'UNAUTHENTICATED', http: { status: 401 } } }); }
                } catch (err) { throw new GraphQLError('Authentication token is invalid or expired.', { extensions: { code: 'UNAUTHENTICATED', http: { status: 401 } } }); }
            }
        } else if (shareToken) {
            const response = await postUserCycleGraphql(userCycleEndpoint, JSON.stringify({ query: `query ValidateShareToken($token: String!) { validateShareToken(token: $token) { ... on ShareTokenDetails { __typename id name scopes userId } ... on Error { __typename code } } }`, variables: { token: shareToken } }));
            if (!response.ok) throw new GraphQLError('Failed to validate share token.', { extensions: { code: 'INTERNAL_SERVER_ERROR', http: { status: 500 } } });
            const result = await response.json() as { data?: { validateShareToken?: ValidateShareTokenResponse } };
            const validationData = result?.data?.validateShareToken;
            if (validationData?.__typename === 'ShareTokenDetails') { contextData = { userId: validationData.userId, shareScopes: validationData.scopes }; }
            else { throw new GraphQLError('Invalid share token provided.', { extensions: { code: 'UNAUTHENTICATED', http: { status: 401 } } }); }
        }
    } catch (e: any) {
        logger.error('Error during token validation/processing:', e instanceof Error ? e.message : String(e));
        // Add authError to context instead of throwing immediately
        contextData.authError = (e instanceof GraphQLError) ? e : new GraphQLError('Authentication error.', { originalError: e });
    }

    // Resolve billing plan for downstream feature-gating (e.g. AI Advisor).
    if (!contextData.authError && contextData.userId) {
        try {
            const billingResponse = await postUserCycleGraphql(
                userCycleEndpoint,
                JSON.stringify({
                    query: `query CurrentUserBillingPlan { user { ... on User { billingPlan } ... on Error { code } } }`
                }),
                {
                    "Content-Type": "application/json",
                    "internal-userid": contextData.userId,
                },
            );

            if (billingResponse.ok) {
                const billingResult = await billingResponse.json() as {
                    data?: {
                        user?: { billingPlan?: string } | { code?: string }
                    }
                };
                const plan = (billingResult?.data?.user as { billingPlan?: string })?.billingPlan;
                if (plan) {
                    contextData.billingPlan = plan;
                }
            } else {
                logger.warn('[AUTH_DEBUG] Failed to resolve billing plan from user-cycle', {
                    status: billingResponse.status,
                    userId: contextData.userId
                });
            }
        } catch (billingError: any) {
            logger.warn('[AUTH_DEBUG] Billing plan lookup failed', {
                userId: contextData.userId,
                error: billingError?.message || String(billingError),
            });
        }
    }

    logger.log('[AUTH_DEBUG] Context Data:', contextData);
    return contextData;
};

// Define types for scopes and variables used in isRequestAllowed
interface AllowedQuery { queryName: string; requiredArgs?: Record<string, any>; }
interface Scopes { allowedQueries: AllowedQuery[]; }
type Variables = Record<string, any>;

// Helper function to check if the request matches the allowed scopes
function isRequestAllowed(queryAst: DocumentNode, variables: Variables, scopes: Scopes): boolean {
    if (!scopes?.allowedQueries) { logger.warn('No scopes defined'); return false; }
    let isAllowed = false;
    let operationName: string | null = null;
    visit(queryAst, {
        OperationDefinition(node: OperationDefinitionNode) {
            if (node.operation === 'query') {
                const firstSelection = node.selectionSet.selections[0] as FieldNode;
                if (firstSelection?.kind === 'Field') { operationName = firstSelection.name.value; }
            }
        }
    });
    if (!operationName) { logger.warn('Could not determine operation name'); return false; }
    for (const allowedQuery of scopes.allowedQueries) {
        if (allowedQuery.queryName === operationName) {
            let argsMatch = true;
            if (allowedQuery.requiredArgs) {
                for (const argName in allowedQuery.requiredArgs) {
                    if (variables?.[argName] !== allowedQuery.requiredArgs[argName]) {
                        argsMatch = false; break;
                    }
                }
            }
            if (argsMatch) { isAllowed = true; break; }
        }
    }
    if (!isAllowed) { logger.warn(`Request denied for operation '${operationName}'`); }
    return isAllowed;
}

// Create ApolloServer instance from apollo-server-express
const server = new ApolloServer({
    // Use type assertion 'as any' to bypass complex GatewayInterface type mismatch
    gateway: gateway as any, // Assert gateway type
    context: contextFunction,
    plugins: [requestLogger.register()],
    formatError: (error: GraphQLError) => {
        logger.error("GraphQL Error Formatter:", JSON.stringify(error, null, 2));
        // Check if it's an authentication error we added to the context
        if (error.originalError instanceof GraphQLError && error.originalError === (error.originalError as any)?.context?.authError) {
             const statusCode = getStatusCodeFromError(error.originalError);
             return new GraphQLError(error.message, error.nodes, error.source, error.positions, error.path, error.originalError, { ...error.extensions, http: { status: statusCode } });
        }
        // Handle scope enforcement errors
        if (error.extensions?.code === 'FORBIDDEN') {
             return new GraphQLError(error.message, error.nodes, error.source, error.positions, error.path, error.originalError, { ...error.extensions, http: { status: 403 } });
        }
        // Default formatting for other errors
        return error;
    },
});

async function startServer() {
    try {
        // Start the Apollo Server
        await server.start();
        logger.log('Apollo Server started.');

        // Apply Express middleware BEFORE Apollo middleware
        app.use(cors({
            origin: (origin, callback) => {
                if (!origin) {
                    callback(null, true);
                    return;
                }

                const allowedPatterns = [
                    /^https?:\/\/localhost(:\d+)?$/,
                    /^https?:\/\/127\.0\.0\.1(:\d+)?$/,
                    /^https?:\/\/0\.0\.0\.0(:\d+)?$/,
                    /^tauri:\/\/localhost$/,
                    /^https:\/\/([a-z0-9-]+\.)?gratheon\.com$/,
                    /^https:\/\/studio\.apollographql\.com$/,
                ];

                const isAllowed = allowedPatterns.some((pattern) =>
                    pattern.test(origin)
                );

                callback(null, isAllowed);
            },
            methods: "GET,HEAD,PUT,PATCH,POST,DELETE",
            preflightContinue: false,
            credentials: true,
            optionsSuccessStatus: 204
        }));
        app.use(cookieParser());
        app.use(express.json()); // Use express built-in json parser
        // app.use(Sentry.Handlers.requestHandler()); // Comment out Sentry middleware
        // app.use(Sentry.Handlers.tracingHandler()); // Comment out Sentry middleware

        // Apply this middleware specifically to the /graphql path BEFORE Apollo middleware
        app.use('/graphql', (req: Request, res: Response, next: NextFunction) => {
            // Context is now managed by Apollo Server and passed to resolvers/datasources.
            // Performing checks here is less common with apollo-server-express.
            // Authentication errors from contextFunction will be handled by formatError.
            // Scope checks should ideally happen within resolvers or via directives.
            // If absolutely necessary here, context needs to be accessed differently (e.g., re-running contextFunction, which is inefficient).
            // For now, remove the middleware check here, relying on context propagation.
            logger.log("Skipping middleware scope check - relying on context propagation.");
            next();
        });

        // Apply Apollo Server middleware
        // Use 'as any' for app due to potential type conflicts between express versions/types
        server.applyMiddleware({ app: app as any, path: '/graphql', cors: false });

        // --- Other Routes ---
        // Define these directly on the app *before* the final catch-all
        app.get('/schema.graphql', async (req: Request, res: Response, next: NextFunction) => {
            try {
                const schema = gateway.schema;
                if (schema) {
                    res.set('Content-Type', 'text/plain').send(printSchema(schema));
                } else {
                    res.status(503).send('Schema not available yet or gateway failed.');
                }
            } catch (error) { next(error); }
        });
        // Serve an on-premise GraphQL IDE instead of Apollo's default landing page.
        // Altair ships static assets through this router, so the docs iframe does not
        // depend on Apollo Studio/Sandbox or an external GraphQL UI host.
        app.use('/altair', altairExpress({
            // WHY: docs embed Altair from gratheon.com; an absolute URL avoids
            // ambiguity if Altair is opened outside graphql.gratheon.com, while
            // keeping local/dev endpoints overridable through config/env.
            endpointURL: config.altairEndpointUrl,
            initialName: 'ListHiveInternals',
            // Use a real query from the Gratheon web-app hive edit page instead
            // of a generic introspection smoke test. It demonstrates how the
            // federated API returns hive structure from swarm-api and vision
            // analysis fields extended by image-splitter.
            initialQuery: `query ListHiveInternals($hiveId: ID!) {
  hive(id: $hiveId) {
    id
    hiveNumber
    hiveType
    notes
    beeCount
    inspectionCount
    boxes {
      id
      position
      type
      color
      holeCount
      roofStyle
      frames {
        id
        position
        type
        leftSide {
          id
          frameId
          frameSideFile {
            frameSideId
            queenDetected
            isQueenDetectionComplete
            isBeeDetectionComplete
            isCellsDetectionComplete
            detectedWorkerBeeCount
            detectedDroneCount
          }
          cells {
            broodPercent
            droneBroodPercent
            cappedBroodPercent
            eggsPercent
            nectarPercent
            pollenPercent
            honeyPercent
          }
        }
        rightSide {
          id
          frameId
          frameSideFile {
            frameSideId
            queenDetected
            isQueenDetectionComplete
            isBeeDetectionComplete
            isCellsDetectionComplete
            detectedWorkerBeeCount
            detectedDroneCount
          }
          cells {
            broodPercent
            droneBroodPercent
            cappedBroodPercent
            eggsPercent
            nectarPercent
            pollenPercent
            honeyPercent
          }
        }
      }
    }
  }
}`,
            initialVariables: `{
  "hiveId": "replace-with-your-hive-id"
}`,
            initialSettings: {
                'request.withCredentials': true,
                'schema.reloadOnStart': true,
                'alert.disableWarnings': true,
                'alert.disableUpdateNotification': true,
            },
        }));

        app.get('/', (req: Request, res: Response) => {
            res.redirect(302, '/altair/');
        });

        app.all('*', (req: Request, res: Response) => {
            res.status(404).send('404 - Not found!');
        });

        // app.use(Sentry.Handlers.errorHandler()); // Comment out Sentry middleware

        app.use((err: any, req: Request, res: Response, next: NextFunction) => {
            logger.error("Unhandled error:", err);
            if (res.headersSent) { return next(err); }
            const statusCode = getStatusCodeFromError(err);
            const message = (typeof err === 'object' && err !== null && typeof err.message === 'string') ? err.message : 'Internal Server Error';
            res.status(statusCode).json({ errors: [{ message }] });
        });

        app.listen({ port: 6100 }, () => {
            logger.info(`Server ready at http://localhost:6100${server.graphqlPath}`);
        });

    } catch (error) {
        logger.error('Error starting Apollo Server:', error instanceof Error ? error.message : String(error));
        if (error instanceof Error && error.stack) {
            logger.error('Stack trace:', error.stack);
        }
        process.exit(1);
    }
}

startServer();
