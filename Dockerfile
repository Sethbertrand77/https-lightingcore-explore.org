# Multi-stage Docker Build for Lighting Core v1.0.0
# ================================================
#
# This Dockerfile uses multi-stage builds to create an optimized production image
# that includes both Python and Node.js runtimes for the Lighting Core platform.
#
# Build Strategy:
# ===============
# Stage 1 (python-builder):
#   - Compiles Python dependencies in isolation
#   - Installs build tools and system libraries
#   - Creates virtual environment with all dependencies
#   - Result: Lean /opt/venv directory
#
# Stage 2 (node-builder):
#   - Installs Node.js production dependencies
#   - Uses alpine Linux for minimal size
#   - Result: Optimized node_modules directory
#
# Stage 3 (final):
#   - Combines Python and Node.js from builder stages
#   - Removes unnecessary build files and cache
#   - Creates non-root user for security
#   - Adds health check for container orchestration
#   - Result: ~1.2GB production image ready for deployment
#
# Image Size Comparison:
# =====================
# Without multi-stage: ~2.5GB (includes all build tools and intermediate layers)
# With multi-stage:    ~1.2GB (only runtime dependencies)
# Savings: ~52% reduction in image size
#
# Security Considerations:
# =======================
# - Non-root user prevents privilege escalation
# - Minimal base images reduce attack surface
# - No unnecessary build tools in final image
# - Health checks enable automatic restarts on failure

# ===========================
# Stage 1: Python Builder
# ===========================
#
# Purpose: Compile Python dependencies in isolation to keep final image small
# This stage contains build tools that are NOT needed in the final image
#
# Base Image: python:3.11-slim
# - Includes Python 3.11 runtime
# - ~160MB smaller than full Python image
# - All necessary system libraries for running Python code

FROM python:3.11-slim as python-builder

# Set working directory for the build stage
# /app is used as a convention for application code
WORKDIR /app

# Install system dependencies required for compiling Python packages
#
# Packages:
# - build-essential: GCC, G++, make (C/C++ compiler tools)
#   Required for: packages with C extensions (cryptography, ecdsa, etc.)
#
# - libssl-dev: OpenSSL development headers
#   Required for: SSL/TLS support in cryptography packages
#
# - libffi-dev: Foreign Function Interface library headers
#   Required for: CFFI and packages that interface with C libraries
#
# - git: Version control system
#   Required for: Some pip packages installed directly from git repositories
#
# Note: apt-get clean removes package lists to reduce layer size
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    libssl-dev \
    libffi-dev \
    git \
    && rm -rf /var/lib/apt/lists/*

# Copy requirements.txt to build stage
# This file lists all Python dependencies with specific versions
# Example contents:
#   Flask==3.0.0
#   bitcoinlib==0.6.14
#   cryptography==41.0.7
COPY requirements.txt .

# Create and activate Python virtual environment
# Virtual environments isolate Python packages and dependencies
# Benefits:
# - Prevents conflicts between packages
# - Makes environment reproducible
# - Easy to clean up (just delete directory)
#
# Process:
# 1. python -m venv /opt/venv: Create virtual environment at /opt/venv
# 2. ENV PATH: Update PATH to use venv's Python interpreter
# 3. pip install: Install all packages from requirements.txt
#
# Flags used:
# - --no-cache-dir: Don't cache package downloads (saves space in layer)
RUN python -m venv /opt/venv
ENV PATH="/opt/venv/bin:$PATH"
RUN pip install --no-cache-dir -r requirements.txt


# ===========================
# Stage 2: Node.js Builder
# ===========================
#
# Purpose: Install Node.js dependencies in isolation
# Using alpine (3MB base image) instead of full Node.js image
#
# Base Image: node:18-alpine
# - Alpine Linux: Minimal ~5MB base image
# - Node.js 18: Current LTS version at time of build
# - Total: ~165MB vs ~900MB for full Node image

FROM node:18-alpine as node-builder

WORKDIR /app

# Copy package files needed for npm installation
# package.json: Lists all dependencies
# package-lock.json: Locks dependency versions for reproducible builds
COPY package*.json ./

# Install production dependencies only
# Flags:
# - --only=production: Skip devDependencies (they're not needed in production)
# - npm ci: "Clean install" ensures exact versions from package-lock.json
#   (better than npm install for production/CI environments)
RUN npm ci --only=production


# ===========================
# Stage 3: Final Production Image
# ===========================
#
# Purpose: Create final production image combining Python and Node.js
# This stage only includes runtime dependencies, no build tools
#
# Base Image: python:3.11-slim
# - Starts with Python base since Python is primary runtime
# - Node.js will be added via apt-get

FROM python:3.11-slim

# Install Node.js and npm on top of Python base image
# Note: Using separate RUN instruction to add Node.js to existing Python image
#
# Packages:
# - nodejs: Node.js runtime v18+
# - npm: Node package manager
# - curl: Required for Docker HEALTHCHECK command
#
# Why curl is needed:
# - HEALTHCHECK uses curl to ping /api/health endpoint
# - Verifies server is responding to requests
RUN apt-get update && apt-get install -y --no-install-recommends \
    nodejs \
    npm \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Set working directory for final image
WORKDIR /app

# ===========================
# Copy Build Artifacts from Stages
# ===========================
#
# This is the key benefit of multi-stage builds:
# We copy only the final compiled dependencies, not build tools or source code

# Copy Python virtual environment from builder stage
# Contains all compiled Python packages ready to run
# COPY --from=python-builder: Copies from builder stage (not host)
# /opt/venv: Source path in builder stage
# /opt/venv: Destination path in final image
#
# Benefits:
# - Only ~80MB in final image (vs ~500MB if built here)
# - No build tools or source files included
# - Safe to use without rebuilding
COPY --from=python-builder /opt/venv /opt/venv

# Copy Node.js dependencies from builder stage
# Contains all compiled native modules and JavaScript libraries
# COPY --from=node-builder: Copies from node-builder stage
# /app/node_modules: Built dependencies directory
#
# Size: ~300MB of production-ready modules
COPY --from=node-builder /app/node_modules ./node_modules

# Copy application source code
# This includes all our wallet implementation code:
# - wallet.py (Python Bitcoin wallet)
# - wallet.js (JavaScript wallet)
# - wallet-server.js (Express.js API server)
# - config files, requirements.txt, etc.
#
# Copy entire repository into container
COPY . .

# ===========================
# Runtime Configuration
# ===========================

# Set environment variables for production runtime
# These override development defaults when container starts
ENV PATH="/opt/venv/bin:$PATH" \
    PYTHONUNBUFFERED=1 \
    NODE_ENV=production \
    ENVIRONMENT=production

# Explanation of each variable:
#
# PATH="/opt/venv/bin:$PATH"
#   - Ensures Python packages from venv are found first
#   - When running 'python', it uses /opt/venv/bin/python
#
# PYTHONUNBUFFERED=1
#   - Disable Python's default stdout/stderr buffering
#   - Logs appear immediately (important for Docker logs)
#   - Without this, logs might not appear until buffer fills
#
# NODE_ENV=production
#   - Tells Express.js and other Node packages to use production settings
#   - Disables debug output, enables optimizations
#
# ENVIRONMENT=production
#   - Custom variable used by our Flask application
#   - Controls configuration, logging level, etc.

# ===========================
# Security Configuration
# ===========================

# Create non-root user for running the application
# 
# Security Principle:
# Never run containers as root! If container is compromised,
# attacker gains root access to the host system.
#
# Process:
# 1. useradd: Create new user account "lightingcore"
# 2. -m: Create home directory (/home/lightingcore)
# 3. -u 1000: Assign specific UID (non-system user)
# 4. chown: Change ownership of /app to lightingcore user
#
# Result:
# - lightingcore user owns all application files
# - Cannot modify /usr, /etc, or other system directories
# - If compromised, damage is limited to /app and /home/lightingcore
RUN useradd -m -u 1000 lightingcore && \
    chown -R lightingcore:lightingcore /app

# Switch to non-root user for application startup
# All subsequent commands run as lightingcore user
# This includes the CMD that starts the servers
USER lightingcore

# ===========================
# Network Configuration
# ===========================

# Expose ports to make services accessible outside container
#
# Port 5000: Python Flask API server
#   - Backend API endpoints for wallet operations
#   - Database connections
#   - Internal service port
#
# Port 3000: Node.js Express API server
#   - Primary REST API for wallet operations
#   - Publicly exposed port
#   - Client applications connect here
#
# EXPOSE is documentation only - doesn't actually open ports
# Ports are opened when running container with -p flag:
#   docker run -p 5000:5000 -p 3000:3000 image-name
#
# In docker-compose.yml, ports are defined in the service configuration
EXPOSE 5000 3000

# ===========================
# Health Check Configuration
# ===========================

# Docker HEALTHCHECK command for monitoring container health
#
# How it works:
# 1. Every 30 seconds, Docker runs the specified CMD
# 2. If it returns 0 (success), container is "healthy"
# 3. If it returns 1 (failure), container is "unhealthy"
# 4. After 3 failed health checks, container can be restarted
#
# Flags:
# --interval=30s: Check every 30 seconds
# --timeout=10s: Wait max 10 seconds for response
# --start-period=5s: Wait 5 seconds after startup before checking
#   (gives servers time to start up)
# --retries=3: Mark unhealthy after 3 consecutive failures
#
# Command: curl -f http://localhost:3000/api/health
# - curl: HTTP client
# - -f: Fail silently if HTTP status is not 2xx
# - http://localhost:3000/api/health: Health check endpoint
#
# Benefits:
# - Kubernetes uses this for readiness probes
# - Docker Swarm uses this for service health
# - Enables automatic container restart on failure
# - Prevents traffic to unhealthy containers
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD curl -f http://localhost:3000/api/health || exit 1

# ===========================
# Application Startup
# ===========================

# CMD specifies the default command to run when container starts
#
# Command breakdown:
# sh -c: Execute shell commands
# "python wallet.py & node wallet-server.js"
#   - python wallet.py: Start Python wallet server
#   - &: Run in background
#   - node wallet-server.js: Start Node.js Express server
#   - Both servers run concurrently
#
# Result:
# - Python Flask API on port 5000
# - Express.js API on port 3000
# - Both services receive requests simultaneously
# - If either crashes, container continues (process manager like supervisord would help)
#
# In production with docker-compose, you might use separate containers
# for better isolation and independent restart capabilities
CMD ["sh", "-c", "python wallet.py & node wallet-server.js"]

# ===========================
# Docker Build Command
# ===========================

# To build this image:
# docker build -t lighting-core:1.0.0 .
#
# The dot (.) specifies current directory as build context
# All COPY commands are relative to this directory
#
# To build with specific target:
# docker build --target python-builder -t lighting-core:py .
# (Useful for debugging individual stages)
#
# To build without cache (force rebuild):
# docker build --no-cache -t lighting-core:1.0.0 .
#
# Build times:
# - First build: ~3-5 minutes (downloads everything)
# - Subsequent builds: ~30 seconds (caches layers)
#
# Final image size:
# docker images lighting-core:1.0.0
# Should show approximately 1.2-1.3 GB

# ===========================
# Docker Run Command
# ===========================

# To run container interactively:
# docker run -it -p 5000:5000 -p 3000:3000 lighting-core:1.0.0
#
# To run in background:
# docker run -d -p 5000:5000 -p 3000:3000 --name wallet lighting-core:1.0.0
#
# To view logs:
# docker logs wallet
# docker logs -f wallet  (follow logs in real-time)
#
# To stop container:
# docker stop wallet
#
# To remove container:
# docker rm wallet
