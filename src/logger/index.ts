import { createLogger } from "@gratheon/log-lib";

const { logger: baseLogger } = createLogger();

export const logger = {
    log: (message: string, meta?: any) => baseLogger.info(message, meta as any),
    info: (message: string, meta?: any) => baseLogger.info(message, meta as any),
    warn: (message: string, meta?: any) => baseLogger.warn(message, meta as any),
    debug: (message: string, meta?: any) => baseLogger.debug(message, meta as any),
    error: (message: string | Error | any, meta?: any) => baseLogger.error(message, meta as any),
    errorEnriched: (message: string, error: Error | any, meta?: any) =>
        baseLogger.errorEnriched(message, error, meta as any),
};


process.on('uncaughtException', function (err) {
    console.log("UncaughtException processing: %s", err);
});
