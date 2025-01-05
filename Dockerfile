
# Use Docker's official DinD image
FROM docker:20.10.7-dind

# Install Node.js (if needed)
RUN apk add --no-cache nodejs npm

# Set the working directory inside the container
WORKDIR /usr/src/app

# Copy package.json and package-lock.json (if available)
COPY package*.json ./

# Install dependencies
RUN npm install

# Copy the rest of the application code
COPY . .

<<<<<<< HEAD
=======

>>>>>>> refs/remotes/origin/main
# Expose the port the app runs on
EXPOSE 8000

# Define the command to run the application
CMD ["node", "index.js"]
