const { ApolloGateway } = require('@apollo/gateway');
const { ApolloServerBase, runHttpQuery, convertNodeHttpToRequest } = require('apollo-server-core');
const path = require('path');
const express = require('express');
const { json } = require('body-parser');
const cookieParser = require('cookie-parser');
const jwt = require('jsonwebtoken');
const cors = require('cors');
const Sentry = require('@sentry/node')
const fetch = require("cross-fetch");
const { parse, visit, print } = require('graphql'); // Import parse, visit, and print

const config = require('./config')
const app = express();

Sentry.init({
    dsn: config.sentryDsn,
    environment: process.env.ENV_ID,
    integrations: [
        // enable HTTP calls tracing
        new Sentry.Integrations.Http({ tracing: true }),
        // enable Express.js middleware tracing
        new Sentry.Integrations.Express({
            // to trace all requests to the default router
            app,
            // alternatively, you can specify the routes you want to trace:
            // router: someRouter,
        }),
    ],

    // We recommend adjusting this value in production, or using tracesSampler
    // for finer control
    tracesSampleRate: 1.0,
});

const router = express.Router();

const { privateKey } = require('./config');
// const requestLoggerPlugin = require('./request-logger');
const CustomSupergraphManager = require('./supergraph');
const RemoteGraphQLDataSource = require('./remote-data-source');

const gateway = new ApolloGateway({
    buildService: (service) => new RemoteGraphQLDataSource(this, service),
    supergraphSdl: new CustomSupergraphManager({ pollIntervalInMs: 30000 }),
});

const apolloServerBase = new ApolloServerBase({
    gateway,
    // subscriptions: false,
    // debug: true,
    // plugins: [requestLoggerPlugin.register],
});

apolloServerBase.start();

app.use(router);
router.use(cors({
    // origin: /(.)*.gratheon\.com$/,
    // origin: /(.)*/,
    // allow origin from gratheon.com, localhost (any scheme/port), or tauri://localhost
    origin: /(.)*\.gratheon\.com|localhost|0\.0\.0\.0:8080|tauri:\/\/localhost$/,

    "methods": "GET,HEAD,PUT,PATCH,POST,DELETE",
    "preflightContinue": false,
    credentials: true,
    // Add 'X-Share-Token' to allowed headers
    allowedHeaders: ['Content-Type', 'token', 'X-Share-Token', 'Authorization'], // Also ensure Authorization is allowed for API tokens
    "optionsSuccessStatus": 204
}))
router.use(cookieParser());
router.use(json());
app.use(Sentry.Handlers.requestHandler());
app.use(Sentry.Handlers.tracingHandler());

// Add this block to generate and return the GraphQL schema in SDL format
router.get('/schema.graphql', (req, res) => {
    const schema = apolloServerBase.schema;
    const schemaSDL = printSchema(schema);
    res.set('Content-Type', 'text/plain');
    res.send(schemaSDL);
  });

router.get('/graphql', (req, res) => {
    res.sendFile(path.join(__dirname + '/playground.html'));
});

router.post('/graphql', (req, res, next) => {
    Promise.resolve(handleGraphqlRequest(req, res, next)).catch(next);
});

app.all('*', (req, res) => {
    return res.status(404).send('404 - Not found!');
});

app.use(Sentry.Handlers.errorHandler());

app.listen(6100, "0.0.0.0", () => {
    console.info('Server listening on port: 6100');
});

// Helper function to check if the request matches the allowed scopes
function isRequestAllowed(queryAst, variables, scopes) {
    if (!scopes || !scopes.allowedQueries) {
        console.warn('No scopes or allowedQueries defined for share token.');
        return false; // Deny if scopes are missing or malformed
    }

    let isAllowed = false;
    let operationName = null;

    // Extract the top-level field name (operation) from the AST
    visit(queryAst, {
        OperationDefinition(node) {
            if (node.operation === 'query') { // Only checking queries for now
                const firstSelection = node.selectionSet.selections[0];
                if (firstSelection && firstSelection.kind === 'Field') {
                    operationName = firstSelection.name.value;
                }
            }
            // Can add 'Mutation' handling later if needed
        }
    });

    if (!operationName) {
        console.warn('Could not determine operation name from query AST.');
        return false; // Deny if operation name can't be found
    }

    console.log(`Checking scope for operation: ${operationName}`);

    for (const allowedQuery of scopes.allowedQueries) {
        if (allowedQuery.queryName === operationName) {
            console.log(`Found matching scope for queryName: ${operationName}`);
            let argsMatch = true;
            if (allowedQuery.requiredArgs) {
                for (const argName in allowedQuery.requiredArgs) {
                    const requiredValue = allowedQuery.requiredArgs[argName];
                    const actualValue = variables ? variables[argName] : undefined;
                    console.log(`Checking arg '${argName}': required=${requiredValue}, actual=${actualValue}`);
                    // Note: Simple equality check. Might need type coercion or deeper comparison depending on arg types.
                    if (actualValue !== requiredValue) {
                        argsMatch = false;
                        console.log(`Argument mismatch for '${argName}'`);
                        break; // Mismatch found, no need to check further args for this scope entry
                    }
                }
            }
            if (argsMatch) {
                console.log(`Request allowed by scope: ${JSON.stringify(allowedQuery)}`);
                isAllowed = true;
                break; // Found a matching scope, request is allowed
            }
        }
    }

    if (!isAllowed) {
        console.warn(`Request denied. Operation '${operationName}' with variables ${JSON.stringify(variables)} does not match allowed scopes: ${JSON.stringify(scopes.allowedQueries)}`);
    }

    return isAllowed;
}


async function handleGraphqlRequest(req, res) {
    let contextData = {}; // Initialize empty context
    const userCycleEndpoint = `${config.userCycleUrl}/graphql`;

    try {
        const shareToken = req.headers['x-share-token'];
        const bearer = req.headers['authorization'];
        const cookieToken = req.cookies?.gratheon_session;
        const headerToken = req.headers['token'];

        // Removed erroneous assignment: shareToken = false;

        if (bearer) {
            // Validate Bearer Token
            console.log('Validating bearer token...');
            const bearerToken = bearer.split(' ')[1];
            const bearerTokenValidationResult = await fetch(userCycleEndpoint, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    // You may need to include other headers like authorization if required
                },
                body: JSON.stringify({
                    query: `
                        mutation ValidateApiToken($token: String) {
                          validateApiToken(token: $token) {
                            ... on TokenUser {
                              id
                            }
                            ... on Error {
                              code
                            }
                          }
                        }
                      `,
                    variables: { token: bearerToken },
                }),
            });
            const bearerTokenValidationResultJSON = await bearerTokenValidationResult.json();
            const validationData = bearerTokenValidationResultJSON?.data?.validateApiToken;

            if (validationData && validationData.__typename === 'TokenUser') {
                contextData = { userId: validationData.id };
                console.log('Bearer token validated, userId:', validationData.id);
            } else {
                 console.warn('Bearer token validation failed:', validationData?.code || 'Unknown error');
            }
        } else if (cookieToken || headerToken) {
            // Validate JWT Token (Cookie or Header)
            console.log('Validating JWT token...');
            const token = cookieToken || headerToken;
            const decoded = await new Promise((resolve, reject) => jwt.verify(
                token,
                privateKey, (err, decoded) => {
                    if (err) reject(err);
                    else resolve(decoded);
                }
            ));

            if (decoded?.user_id) {
                contextData = { userId: decoded.user_id };
                console.log('JWT token validated, userId:', decoded.user_id);
            } else {
                 console.warn('JWT token validation failed or missing user_id');
            }
        } else if (shareToken) {
            // Validate Share Token
            console.log('Validating share token...');
            const shareTokenValidationResult = await fetch(userCycleEndpoint, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    query: `
                        query ValidateShareToken($token: String!) {
                          validateShareToken(token: $token) {
                            ... on ShareTokenDetails {
                                __typename
                              id
                              name
                              scopes
                              userId # <<< Add userId here
                            }
                            ... on Error {
                                __typename
                              code
                            }
                          }
                        }
                      `,
                    variables: { token: shareToken },
                }),
            });
            const shareTokenValidationResultJSON = await shareTokenValidationResult.json();
            // Log the raw JSON response received from user-cycle
            console.log('graphql-router received validation response JSON:', JSON.stringify(shareTokenValidationResultJSON, null, 2));
            const validationData = shareTokenValidationResultJSON?.data?.validateShareToken;

            // Add detailed logging before the check
            console.log('graphql-router: Checking validationData:', validationData);
            console.log('graphql-router: Checking validationData.__typename:', validationData ? validationData.__typename : 'validationData is null/undefined');

            if (validationData && validationData.__typename === 'ShareTokenDetails') {
                // Add both userId and shareScopes to context
                contextData = {
                    userId: validationData.userId, // Add userId from validation data
                    shareScopes: validationData.scopes
                };
                console.log(`Share token validated successfully. UserID: ${validationData.userId}, Scopes:`, validationData.scopes);
            } else {
                // Log the reason for failure more explicitly
                if (!validationData) {
                    console.warn('Share token validation failed because validationData is null or undefined.');
                } else if (validationData.__typename !== 'ShareTokenDetails') {
                    console.warn(`Share token validation failed because __typename is "${validationData.__typename}", not "ShareTokenDetails".`);
                } else {
                     console.warn('Share token validation failed for an unexpected reason within the if condition.');
                }
                console.warn('Original failure log data:', validationData?.code || 'Unknown error');
                // Optionally deny request here, or let downstream handle lack of context
            }
        }
        
        
        else {
             console.log('No authentication token provided.');
        }
    } catch (e) {
        console.error('Error during token validation:', e);
        // Decide if request should be denied or proceed without context
    }

    const request = convertNodeHttpToRequest(req);
    const options = await apolloServerBase.graphQLServerOptions({ req, res });

    // Set the context based on validation results
    options.context = contextData;

    // --- Scope Enforcement ---
    if (contextData.shareScopes) {
        console.log('Performing scope enforcement for share token...');
        try {
            // contextData.shareScopes is already an object, no need to parse
            const scopesObject = contextData.shareScopes;
            const queryAst = parse(req.body.query); // Parse the incoming query
            const variables = req.body.variables || {};

            // Pass the scopes object directly to the check function
            if (!isRequestAllowed(queryAst, variables, scopesObject)) {
                // Request is NOT allowed by scopes
                const errorMsg = 'Forbidden: Operation not allowed by share token scope.';
                // Log the object directly for debugging
                console.error(`SCOPE ENFORCEMENT FAILED: ${errorMsg} - Query: ${print(queryAst).replace(/\s+/g, ' ')}, Variables: ${JSON.stringify(variables)}, Scopes: ${JSON.stringify(scopesObject)}`);
                res.status(403).json({
                    errors: [{ message: errorMsg }]
                });
                return; // Stop processing
            }
            console.log(`SCOPE ENFORCEMENT PASSED. Proceeding with request. Query: ${print(queryAst).replace(/\s+/g, ' ')}, Variables: ${JSON.stringify(variables)}`);
        } catch (e) {
            console.error('Error during scope parsing or enforcement:', e);
            res.status(500).json({
                errors: [{ message: 'Internal Server Error during scope enforcement.' }]
            });
            return; // Stop processing on error
        }
    }
    // --- End Scope Enforcement ---

    console.log('Passing context to downstream:', options.context);
    try {
        const { graphqlResponse, responseInit } = await runHttpQuery([req, res], {
            method: req.method,
            query: req.body,
            options,
            request
        });

        if (responseInit.headers) {
            for (const [name, value] of Object.entries(responseInit.headers)) {
                res.setHeader(name, value);
            }
        }

        res.write(graphqlResponse);
        res.end();
    } catch (e) {
        console.error(e);
        res.write(e.message);
        res.end();
    }
};
