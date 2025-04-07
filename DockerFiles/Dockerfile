# Use an official GCC image as the base image (includes C and C++ compilers)
FROM gcc:latest AS build

# Install system packages and development tools
RUN apt-get update && apt-get install -y \
    python3 \
    python3-pip \
    nodejs \
    npm \
    golang-go \
    curl \
    openjdk-17-jdk \
    build-essential

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

# Set Java environment variables
ENV JAVA_HOME=/usr/lib/jvm/java-17-openjdk-amd64
ENV PATH=$JAVA_HOME/bin:$PATH

# Set the working directory
WORKDIR /usr/src/app

# Default command
CMD ["/bin/bash"]