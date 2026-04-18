FROM node:22-bookworm-slim
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY tsconfig.json ./
COPY config ./config
COPY src ./src
RUN npm run build
CMD ["npm", "start"]
