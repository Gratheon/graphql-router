start:
	COMPOSE_PROJECT_NAME=gratheon docker compose -f docker-compose.dev.yml up -d --build
stop:
	COMPOSE_PROJECT_NAME=gratheon docker compose -f docker-compose.dev.yml down
run:
	npm run dev

deploy-copy:
	scp -r Dockerfile docker-compose.yml restart.sh root@gratheon.com:/www/graphql.gratheon.com/
	rsync -av -e ssh --exclude='node_modules' --exclude='.git'  --exclude='.idea' ./ root@gratheon.com:/www/graphql.gratheon.com/

deploy-run:
	# ssh root@gratheon.com 'chmod +x /www/graphql.gratheon.com/restart.sh'
	ssh root@gratheon.com 'bash /www/graphql.gratheon.com/restart.sh'

deploy:
	git rev-parse --short HEAD > .version
	make deploy-copy
	make deploy-run

.PHONY: deploy
