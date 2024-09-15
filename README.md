# gratheon/graphql-router

Routes graphql traffic to federated services depending on graphql schema, polled from graphql-schema-registry

## Authentication

### Accessing with API tokens

- Generate API token in https://app.gratheon.com/account
- Pass API token in authorization headers:

```
curl --location 'http://0.0.0.0:6100/graphql' \
--header 'Content-Type: application/json' \
--data '{"query":"{ apiaries { id name } }"}' \
--header 'Authorization: Bearer API_TOKEN_HERE'
```

## Development

```
just start
```

## Architecture

```mermaid
flowchart LR
    web-app("<a href='https://github.com/Gratheon/web-app'>web-app</a>\n:8080") --> graphql-router
    web-app --"subscribe to events"--> event-stream-filter("<a href='https://github.com/Gratheon/event-stream-filter'>event-stream-filter</a>\n:8300\n:8350") --> redis

    graphql-router("<a href='https://github.com/Gratheon/graphql-router'>graphql-router</a>\n :6100") --> swarm-api("<a href='https://github.com/Gratheon/swarm-api'>swarm-api</a>\n:8100") --> mysql[(mysql\n:5100)]
    graphql-router --> swarm-api --> redis[("<a href='https://github.com/Gratheon/redis'>redis pub-sub</a>\n:6379")]

    graphql-router --> image-splitter("<a href='https://github.com/Gratheon/image-splitter'>image-splitter</a>\n:8800") --> mysql
    graphql-router --> image-splitter --> aws-s3
    graphql-router --> user-cycle("<a href='https://github.com/Gratheon/user-cycle'>user-cycle</a>\n:4000") --> mysql
    graphql-router --> user-cycle --> stripe
    graphql-router --> plantnet("<a href='https://github.com/Gratheon/plantnet'>plantnet</a>\n:8090") --> mysql
    graphql-router --> graphql-schema-registry("graphql-schema-registry\n:6001")
    graphql-router --> weather("<a href='https://github.com/Gratheon/weather'>weather</a>\n:8070")
```

