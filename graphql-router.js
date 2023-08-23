const { ApolloGateway } = require('@apollo/gateway');
const { ApolloServerBase, runHttpQuery, convertNodeHttpToRequest } = require('apollo-server-core');
const path = require('path');
const express = require('express');
const {json} = require('body-parser');
const cookieParser = require('cookie-parser');
const jwt = require('jsonwebtoken');
const cors = require('cors');
const Sentry = require('@sentry/node')

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
    origin: /(.)*/,
    "methods": "GET,HEAD,PUT,PATCH,POST,DELETE",
    "preflightContinue": false,
    credentials: true,
    allowedHeaders: ['Content-Type', 'token'],
    "optionsSuccessStatus": 204
}))
router.use(cookieParser());
router.use(json());
app.use(Sentry.Handlers.requestHandler());
app.use(Sentry.Handlers.tracingHandler());

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

async function handleGraphqlRequest (req, res) {
    let userId;
    try {
        const token = req.cookies?.gratheon_session ? req.cookies?.gratheon_session : req.headers['token'];

        const decoded = await (new Promise((resolve, reject) => jwt.verify(
            token,
            privateKey,
            function (err, decoded) {
                if (err) {
                    reject(err);
                }
                resolve(decoded);
            })));

        console.log('decoded token', decoded);

        userId = decoded?.user_id;
    } catch(e){
        console.log(e);
    }

    const request = convertNodeHttpToRequest(req);
    const options = await apolloServerBase.graphQLServerOptions({
        req,
        res
    });

    options.context = {
        userId
    }

    console.log('passing user context', userId);
    try {
        const {graphqlResponse, responseInit} = await runHttpQuery([req, res], {
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
