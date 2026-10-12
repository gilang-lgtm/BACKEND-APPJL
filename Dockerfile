
FROM node:20-bookworm-slim

WORKDIR /app

COPY package*.json ./
RUN npm install --omit=dev

COPY . .

ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=3000

RUN mkdir -p /app/sessions /app/data

EXPOSE 3000

CMD ["npm", "start"]
