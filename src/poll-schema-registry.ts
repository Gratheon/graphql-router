import request from 'request-promise-native';
import {get} from './config';
import { ServiceDefinition } from '@apollo/gateway';
import { parse, DocumentNode } from 'graphql'; // Import parse and DocumentNode
import { logger } from './logger'; // Import logger

// Interface for the raw schema definition received from the registry
interface RawSchemaDefinition {
    name: string;
    url?: string; // url might be optional based on the warning
    version: string;
    type_defs: string;
    type_defs_original: string; // Keep this if used elsewhere, otherwise potentially remove
}

// Interface for the structure returned by the schema registry API call
interface SchemaRegistryResponse {
    data: RawSchemaDefinition[];
    // Add other potential properties if the response structure is more complex
}

// Interface for the return value of the function
interface ServiceListResult {
    services: ServiceDefinition[];
    schemaChanged: boolean;
}

// Type for the cache map
type ServiceSdlCache = Map<string, string>;

export async function getServiceListWithTypeDefs(serviceSdlCache: ServiceSdlCache): Promise<ServiceListResult> {
    const baseUrl = get('schemaRegistryUrl');
    let schemaChanged = false;

    logger.log(`Fetching schemas from registry at ${baseUrl}`);

    try {
        // Explicitly type the expected response structure
        const serviceTypeDefinitions: SchemaRegistryResponse = await request({
            baseUrl,
            method: 'GET',
            url: '/schema/latest',
            json: true,
        });

        // Use optional chaining and provide a default empty array
        const rawSchemas = serviceTypeDefinitions?.data ?? [];

        // Define an intermediate type for the map result before filtering
        type MappedService = {
            name: string;
            url: string | undefined;
            typeDefs: DocumentNode | undefined;
        }

        const mappedServices: MappedService[] = rawSchemas.map((schema: RawSchemaDefinition): MappedService => {
            if (!schema.url) {
                logger.warn(
                    `Service url not found for type definition "${schema.name}"`
                );
                // Decide how to handle missing URL - throw error, skip service, provide default?
                // For now, let's keep the structure but the URL will be invalid.
            } else {
                logger.log(
                    `Got ${schema.name} service schema with version ${schema.version}`
                );
            }

            const previousDefinition: string | undefined = serviceSdlCache.get(schema.name);
            if (schema.type_defs !== previousDefinition) {
                logger.log(`Schema changed detected for service: ${schema.name}`);
                schemaChanged = true;
            }

            serviceSdlCache.set(schema.name, schema.type_defs);

            // Parse the type definitions string into a DocumentNode
            let typeDefsAst: DocumentNode | undefined;
            try {
                typeDefsAst = parse(schema.type_defs);
            } catch (parseError: any) {
                logger.error(`Failed to parse typeDefs for service ${schema.name}:`, parseError instanceof Error ? parseError.message : String(parseError));
                // Decide how to handle parsing errors - skip service?
                // For now, we'll allow returning undefined typeDefs, but filter later
            }


            // Construct the ServiceDefinition object expected by Apollo Gateway
            return {
                name: schema.name,
                url: schema.url ? `http://${schema.url}` : undefined,
                typeDefs: typeDefsAst, // Assign the parsed AST
            };
            // The object above might not strictly be ServiceDefinition yet due to potential undefined typeDefs
        });

        // Filter the mapped services using the type predicate
        const services: ServiceDefinition[] = mappedServices.filter(
            (service): service is ServiceDefinition & { url: string } => // Type predicate narrows down MappedService to ServiceDefinition
                service.url !== undefined && service.typeDefs !== undefined
        );


        return { services, schemaChanged };

    } catch (error: any) {
        logger.error("Error fetching schemas from registry:", error instanceof Error ? error.message : String(error));
        // Return empty list or re-throw error based on desired behavior
        return { services: [], schemaChanged: false };
    }
}
