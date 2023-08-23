cd /www/graphql.gratheon.com/

sudo -H -u www bash -c 'cd /www/graphql.gratheon.com/ && npm i' 

docker-compose down
COMPOSE_PROJECT_NAME=gratheon docker-compose up --build -d
