# Use an official Node.js runtime as the base image
FROM node:18

# Set the working directory inside the container
WORKDIR /usr/src/app

# Copy package.json and package-lock.json (if available)
COPY package*.json ./

# Install dependencies
RUN npm install

# Copy the rest of the application code
COPY . .

# build compilation image
RUN docker build -t comp DockerFiles
# Expose the port the app runs on
EXPOSE 8000

# Define the command to run the application
CMD ["node", "index.js"]