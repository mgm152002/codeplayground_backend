# Use an official GCC image as the base image
FROM gcc:latest AS build

# Install necessary tools for Python and Node.js
RUN apt-get update && apt-get install -y \
    python3 \
    python3-pip \
    nodejs \
    npm

# Set the working directory
WORKDIR /usr/src/app

# Default entry point (can be overwritten by specific language execution)
