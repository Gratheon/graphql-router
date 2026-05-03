import { createLogger } from '@gratheon/log-lib';

const { logger: sharedLogger } = createLogger();

type RouterLogger = {
    log: (message: string, meta?: any) => void;
    info: (message: string, meta?: any) => void;
    error: (message: string | Error | any, meta?: any) => void;
    errorEnriched: (message: string, error: Error | any, meta?: any) => void;
    warn: (message: string, meta?: any) => void;
    debug: (message: string, meta?: any) => void;
};

const logger: RouterLogger = {
    ...sharedLogger,
    log: sharedLogger.info,
    info: sharedLogger.info,
    error: sharedLogger.error,
    errorEnriched: sharedLogger.errorEnriched,
    warn: sharedLogger.warn,
    debug: sharedLogger.debug,
};

process.on('uncaughtException', function (err) {
    logger.error('UncaughtException processing', err);
});

export { logger };
