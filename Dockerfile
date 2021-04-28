FROM node:carbon

#RUN mkdir -p /usr/src/app
WORKDIR /usr/src/app
COPY . /usr/src/app


RUN npm install
RUN npm install socket.io
RUN npm install express
RUN npm install ejs
#RUN npm install -g pm2

# COPY . /usr/src/app
#COPY . /usr/src/app
#RUN ./node_modules/

# ENV node_env=production

EXPOSE 3001

CMD ["node","server.js"]
# CMD [ "npm", "run", "start:pm2" ]

