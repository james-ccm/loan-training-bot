FROM node:18

# Set the working directory inside the container
WORKDIR /usr/src/app

# Copy package.json and package-lock.json
COPY package*.json ./

# Install dependencies
RUN npm install --production

# Copy all application files
COPY . .

# Set environment variables (Google Cloud Run uses PORT 8080)
ENV PORT=8080
EXPOSE 8080

# Start the application
CMD ["node", "index.js"]