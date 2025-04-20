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
    private timerRef: NodeJS.Timeout | null = null;

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

        if (!services || services.length === 0) {
            logger.warn("No services found from registry, using default service.");
            services = [defaultService];
            schemaChanged = true; // Assume change if falling back to default
        }

        // Filter out services that might have failed parsing in getServiceListWithTypeDefs
        const validServices = services.filter(s => s.typeDefs);

        if (validServices.length === 0) {
             logger.error("No valid services with parsable typeDefs found. Cannot compose supergraph.");
             // Return previous SDL or throw error? For now, return empty SDL and signal no change (or error state)
             // Returning empty might cause gateway issues. Throwing might be better.
             throw new Error("Cannot build supergraph: No valid service definitions found.");
        }


        return { supergraphSdl: compose(validServices), schemaChanged };
    }

    private beginPolling(): void {
        if (this.state.phase !== 'initialized') {
            logger.warn(`Polling already started or manager is stopped. State: ${this.state.phase}`);
            return;
        }
        logger.log(`Starting schema polling every ${this.pollIntervalInMs} ms`);
        this.state = State.Polling;
        this.poll();
    }

    private poll(): void {
        // Clear existing timer if any (safety measure)
        if (this.timerRef) {
            clearTimeout(this.timerRef);
        }

        this.timerRef = setTimeout(async () => {
            if (this.state.phase !== 'polling') {
                logger.log("Polling stopped, exiting poll loop.");
                this.timerRef = null;
                return; // Exit if state changed
            }

            try {
                logger.info('Polling schema registry...');
                const { supergraphSdl, schemaChanged } = await this.buildSupergraph();
                logger.info('Polling done.');

                if (schemaChanged && this.update) {
                    logger.info('Schema changed, updating supergraph...');
                    this.update(supergraphSdl); // Pass the SDL string directly
                    logger.info('Supergraph update triggered.');
                } else {
                    logger.info('No supergraph update needed.');
                }
            } catch (error: any) {
                 logger.error("Error during schema polling or supergraph build:", error instanceof Error ? error.message : String(error));
                 // Decide if polling should continue or stop on error
            }


            // Schedule next poll only if still in polling state
            if (this.state.phase === 'polling') {
                this.poll();
            } else {
                 this.timerRef = null; // Clear ref if stopped during async op
            }

        }, this.pollIntervalInMs);
    }
}

// Type the compose function parameter and handle errors more robustly
function compose(services: ServiceDefinition[]): string {
    logger.log(`Composing supergraph with ${services.length} services: ${services.map(s => s.name).join(', ')}`);
    const composed: CompositionResult = composeServices(services);

    if (composed.errors && composed.errors.length > 0) {
        const errorMessages = composed.errors.map((e: GraphQLError) => `\t${e.message}`).join('\n');
        logger.error('Errors composing the supergraph:\n', errorMessages);
        // Depending on severity, you might want to throw or return a previous valid SDL
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
