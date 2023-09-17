FROM node:18-alpine

# ensure all directories exist
WORKDIR /app

COPY . /app/
RUN npm install -g npm@10.1.0
RUN npm install

EXPOSE 6100

CMD ["node", "graphql-router.js"]
