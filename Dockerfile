FROM nginx:1.27-alpine

ENV API_URL=http://127.0.0.1:8765
COPY nginx/default.conf.template /etc/nginx/templates/default.conf.template
COPY public /usr/share/nginx/html

EXPOSE 80
