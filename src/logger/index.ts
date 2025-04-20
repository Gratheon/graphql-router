function log(level: string, message: string, meta?: any) {
    let time = new Date().toISOString();
    let hhMMTime = time.slice(11, 19);
    meta = meta ? JSON.stringify(meta) : '';

    // colorize time to have ansi blue color
    hhMMTime = `\x1b[34m${hhMMTime}\x1b[0m`;

    if (level === 'error') {
        level = `\x1b[31m${level}\x1b[0m`;
        meta = `\x1b[35m${meta}\x1b[0m`;
    } else if (level === 'info') {
        level = `\x1b[32m${level}\x1b[0m`;
        meta = `\x1b[35m${meta}\x1b[0m`;
    } else if (level === 'debug') {
        level = `\x1b[90m${level}\x1b[0m`;
        message = `\x1b[90m${message}\x1b[0m`;
        meta = `\x1b[90m${meta}\x1b[0m`;
    } else if (level === 'warn') {
        level = `\x1b[33m${level}\x1b[0m`;
        meta = `\x1b[35m${meta}\x1b[0m`;
    }

    console.log(`${hhMMTime} [${level}]: ${message} ${meta}`);
}

export const logger = {
    log: (message: string, meta?: any) => {
        log('info', message, meta)
    },
    info: (message: string, meta?: any) => {
        log('info', message, meta)
    },
    error: (message: string | Error | any, meta?: any) => {
        if (message.message && message.stack) {
            return log('error', message.message, {
                stack: message.stack,
                ...meta
            });
        }
        log('error', String(message), meta)
    },
    errorEnriched: (message: string, error: Error|any, meta?: any) => {
        if (error.message && error.stack) {
            return log('error', `${message}: ${error.message}`, {
                stack: error.stack,
                ...meta
            });
        }
        log('error', String(message), meta)
    },
    warn: (message: string, meta?: any) => {
        log('warn', message, meta)
    },

    // do not store debug logs in DB
    debug: (message: string, meta?: any) => {
        log('debug', message, meta)
    },
};


process.on('uncaughtException', function (err) {
    console.log("UncaughtException processing: %s", err);
});
