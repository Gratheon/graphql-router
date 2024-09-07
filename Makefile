start:
	source $(HOME)/.nvm/nvm.sh && nvm install 20 && nvm use && npm i
	COMPOSE_PROJECT_NAME=gratheon docker compose -f docker-compose.dev.yml up --build
stop:
	COMPOSE_PROJECT_NAME=gratheon docker compose -f docker-compose.dev.yml down
run:
	npm run dev

.PHONY: deploy
