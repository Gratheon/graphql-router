import { getServiceListWithTypeDefs } from './poll-schema-registry';
import { composeServices, CompositionResult } from '@apollo/composition';
import { ServiceDefinition } from '@apollo/gateway'; // Removed SupergraphSdlUpdate import
import { parse, DocumentNode, GraphQLError } from 'graphql';

import {logger} from './logger';

// Define State using an enum or string literal types for better type safety
type ManagerPhase = 'initialized' | 'polling' | 'stopped';
interface ManagerState {
    phase: ManagerPhase;
}

const State: Record<string, ManagerState> = {
    Initialized: { phase: 'initialized' },
    Polling: { phase: 'polling' },
    Stopped: { phase: 'stopped' },
};

// Define options interface
interface CustomSupergraphManagerOptions {
    pollIntervalInMs?: number;
}

// Define initialize options interface - update function expects the SDL string directly
interface InitializeOptions {
    update: (supergraphSdl: string) => void;
    // Add other potential properties from gateway initialization if needed
}

// Define buildSupergraph return type
interface BuildSupergraphResult {
    supergraphSdl: string;
    schemaChanged: boolean;
}

// Parse the default service typeDefs into a DocumentNode
let defaultServiceTypeDefsAst: DocumentNode;
try {
    defaultServiceTypeDefsAst = parse('type Query { default: String }');
} catch (e) {
    logger.error("Failed to parse default service typeDefs", e);
    // Handle error appropriately, maybe throw or use a fallback
    throw new Error("Could not parse default service typeDefs");
}

const defaultService: ServiceDefinition = {
    name: 'default',
    // version: '1.0', // Version is not part of ServiceDefinition
    url: 'http://localhost:8080/graphql', // Consider making this configurable
    typeDefs: defaultServiceTypeDefsAst,
};

class CustomSupergraphManager {
    private pollIntervalInMs?: number;
    private serviceSdlCache: Map<string, string>;
    private state: ManagerState;
    // Update the type annotation for the update function
    private update?: (supergraphSdl: string) => void;
    private lastValidSupergraphSdl: string | null = null;

    constructor(options?: CustomSupergraphManagerOptions) {
        this.pollIntervalInMs = options?.pollIntervalInMs;
        this.serviceSdlCache = new Map<string, string>();
        this.state = State.Initialized;
    }

    async initialize({ update }: InitializeOptions): Promise<{ supergraphSdl: string; cleanup: () => Promise<void> }> {
        this.update = update;
        const { supergraphSdl } = await this.buildSupergraph();

        if (this.pollIntervalInMs) {
            this.beginPolling();
        }

        return {
            supergraphSdl,
            cleanup: async (): Promise<void> => {
                logger.info("Cleaning up Supergraph Manager polling...");
                this.state = State.Stopped;
                if (this.timerRef) {
                    clearTimeout(this.timerRef);
                    this.timerRef = null;
                    logger.info("Polling stopped.");
                }
            },
        };
    }

    private async buildSupergraph(): Promise<BuildSupergraphResult> {
        let { services, schemaChanged } = await getServiceListWithTypeDefs(this.serviceSdlCache);

        if (services.length === 0) {
            logger.warn("No services found from registry.");
            if (this.lastValidSupergraphSdl) {
                logger.warn("Keeping last known good schema.");
                return { supergraphSdl: this.lastValidSupergraphSdl, schemaChanged: false };
            }
            logger.warn("No previous schema available, using default service.");
            services = [defaultService];
            schemaChanged = true;
        }

        const validServices = services.filter(s => s.typeDefs);

        if (validServices.length === 0) {
            if (this.lastValidSupergraphSdl) {
                logger.error("No valid services with parsable typeDefs found. Keeping last known good schema.");
                return { supergraphSdl: this.lastValidSupergraphSdl, schemaChanged: false };
            }
            logger.error("No valid services with parsable typeDefs found and no previous schema available. Cannot compose supergraph.");
            throw new Error("Cannot build supergraph: No valid service definitions found.");
        }

        const supergraphSdl = compose(validServices);
        this.lastValidSupergraphSdl = supergraphSdl;
        return { supergraphSdl, schemaChanged };
    }

    private timerRef: NodeJS.Timeout | null = null;

    private beginPolling(): void {
        if (this.state.phase === 'polling') {
            return;
        }
        this.state = State.Polling;
        this.poll();
    }

    private poll(): void {
        if (this.timerRef) {
            clearTimeout(this.timerRef);
        }

        this.timerRef = setTimeout(async () => {
            if (this.state.phase !== 'polling') {
                logger.log("Polling stopped, exiting poll loop.");
                this.timerRef = null;
                return;
            }

            try {
                logger.info('Polling schema registry...');
                const { supergraphSdl, schemaChanged } = await this.buildSupergraph();
                logger.info('Polling done.');

                if (schemaChanged && this.update) {
                    logger.info('Schema changed, updating supergraph...');
                    this.update(supergraphSdl);
                } else {
                    logger.info('No supergraph update needed.');
                }
            } catch (error) {
                logger.error("Error during schema polling or supergraph build:", error instanceof Error ? error.message : String(error));
                if (this.lastValidSupergraphSdl) {
                    logger.info("Continuing with last known good schema.");
                } else {
                    logger.error("No fallback schema available.");
                }
            }

            if (this.state.phase === 'polling') {
                this.poll();
            } else {
                this.timerRef = null;
            }
        }, this.pollIntervalInMs);
    }
}

function compose(services: ServiceDefinition[]): string {
    logger.log(`Composing supergraph with ${services.length} services: ${services.map(s => s.name).join(', ')}`);
    const composed: CompositionResult = composeServices(services);

    if (composed.errors && composed.errors.length > 0) {
        const errorMessages = composed.errors.map((e: GraphQLError) => `\t${e.message}`).join('\n');
        logger.error('Errors composing the supergraph:\n', errorMessages);
        throw new Error(`Supergraph composition failed:\n${errorMessages}`);
    }

    if (!composed.supergraphSdl) {
         logger.error('Composition succeeded but produced no supergraph SDL.');
         throw new Error('Supergraph composition failed: No SDL generated.');
    }

    logger.log("Supergraph composition successful.");
    return composed.supergraphSdl;
}

export default CustomSupergraphManager;
