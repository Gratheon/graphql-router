FROM node:16-alpine

# setup env for consul to be able to track state of service
ENV SERVICE_DESC="graphql-router"

USER nobody

# ensure all directories exist
WORKDIR /app

EXPOSE 6100

CMD ["node", "graphql-service.js"]
