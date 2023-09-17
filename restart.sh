cd /www/graphql-router/

sudo -H -u www bash -c 'cd /www/graphql-router/ && npm i' 

docker-compose down
COMPOSE_PROJECT_NAME=gratheon docker-compose up --build -d
