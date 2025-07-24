# 🧪 Code Playground Backend

A secure and containerized backend system that enables compilation and execution of source code in multiple programming languages without relying on any external APIs.

## 🚀 Features

- Compile and run code in:
  - C
  - C++
  - Go
  - Rust
  - Python
  - JavaScript (Node.js)
- No external APIs required — all code execution happens locally inside isolated containers
- Secure sandboxing using Docker to prevent unauthorized access or harmful system operations
- Lightweight and extensible design for easy language additions

## 🛠️ Tech Stack

- **Backend:** Node.js
- **Containerization:** Docker
- **Languages Supported:**
  - C (`gcc`)
  - C++ (`g++`)
  - Go (`go run`)
  - Rust (`rustc`)
  - Python (`python3`)
  - JavaScript (`node`)

## 🔒 Security

Each code execution is sandboxed using Docker containers:
- Limited CPU and memory resources
- No network access inside containers
- Short-lived containers — destroyed after execution
- Read-only filesystem (except temporary code directory)



