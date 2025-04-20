cd /www/graphql-router/

#sudo -H -u www bash -c 'cd /www/graphql-router/ && npm i'

COMPOSE_PROJECT_NAME=gratheon docker-compose -f docker-compose.prod.yml down
COMPOSE_PROJECT_NAME=gratheon docker-compose -f docker-compose.prod.yml up --build -d
