# Use an official GCC image as the base image (includes C and C++ compilers)
FROM gcc:latest AS build

# Install system packages and development tools
RUN apt-get update && apt-get install -y \
    ca-certificates \
    python3 \
    python3-pip \
    nodejs \
    npm \
    golang-go \
    curl \
    default-jdk \
    build-essential \
    && rm -rf /var/lib/apt/lists/*

# Set Go environment variables
ENV GOPATH=/go
ENV GOBIN=$GOPATH/bin
ENV PATH=$PATH:$GOBIN

# Install Rust using rustup (official installer)
RUN curl https://sh.rustup.rs -sSf | sh -s -- -y

# Add Rust to PATH
ENV PATH="/root/.cargo/bin:${PATH}"

# Create Go workspace directories
RUN mkdir -p $GOPATH/src $GOPATH/bin

# Set the working directory
WORKDIR /usr/src/app

# Default command
CMD ["/bin/bash"]
