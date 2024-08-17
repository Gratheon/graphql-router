let config;

if (process.env.ENV_ID === 'dev') {
	config = require('./config.dev')
}
else {
	config = require('./config.prod')
}

module.exports = config;
