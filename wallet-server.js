/**
 * Lighting Core Wallet API Server
 * ===============================
 * 
 * Express.js based REST API server for the Lighting Core Bitcoin Lightning
 * Network wallet platform. Provides comprehensive endpoints for wallet management,
 * transaction operations, and Lightning channel management.
 * 
 * Architecture Overview:
 * =====================
 * This server uses Express.js to expose RESTful endpoints that allow clients to:
 * 1. Create and manage Bitcoin wallets
 * 2. Send and receive transactions with dynamic fee calculation
 * 3. Accelerate stuck transactions using Replace-By-Fee (RBF)
 * 4. Create and manage Lightning Network payment channels
 * 5. Monitor wallet health and platform statistics
 * 
 * Security Features:
 * - Helmet.js: Adds security HTTP headers to prevent common vulnerabilities
 * - CORS: Enables controlled cross-origin requests
 * - Body Parser: Safely parses incoming JSON/URL-encoded requests
 * - Structured Logging: All requests and errors logged with Pino
 * - Error Handling: Global error handler catches all unhandled exceptions
 * 
 * Middleware Stack (in execution order):
 * 1. helmet() - Security headers (X-Frame-Options, Content-Security-Policy, etc.)
 * 2. compression() - Gzip response compression for bandwidth reduction
 * 3. bodyParser.json() - Parses application/json request bodies
 * 4. bodyParser.urlencoded() - Parses form-encoded request bodies
 * 5. morgan('combined') - HTTP request logging to console
 * 6. cors() - Enables cross-origin requests
 * 
 * Endpoints Provided:
 * - POST /api/wallet/create - Create new Bitcoin wallet
 * - GET /api/wallet/:walletId - Get wallet information
 * - GET /api/wallet/:walletId/balance - Get current balance
 * - GET /api/wallet/:walletId/addresses - List all wallet addresses
 * - POST /api/transaction/send - Send Bitcoin transaction
 * - GET /api/transaction/:walletId/history - Get transaction history
 * - POST /api/transaction/:walletId/accelerate - Accelerate stuck transactions
 * - POST /api/lightning/channel/create - Create Lightning channel
 * - GET /api/health - Health check endpoint
 * - GET /api/stats - Platform-wide statistics
 * 
 * Error Handling Strategy:
 * =====================
 * - 400 Bad Request: Missing or invalid parameters
 * - 404 Not Found: Wallet or resource not found
 * - 500 Internal Server Error: Unexpected server errors
 * All errors include descriptive messages for debugging
 * 
 * Author: Lighting Core Development Team
 * Version: 1.0.0
 * License: MIT
 * Repository: https://github.com/Sethbertrand77/https-lightingcore-explore.org
 */

const express = require('express');
const cors = require('express-cors');
const bodyParser = require('body-parser');
const compression = require('compression');
const helmet = require('helmet');
const morgan = require('morgan');
const pino = require('pino');
const dotenv = require('dotenv');

// Import wallet implementation from wallet.js
const { BitcoinWallet, WalletType } = require('./wallet');

/**
 * Load environment variables from .env file
 * Allows configuration without code changes (12-factor app principle)
 * Variables like PORT, ENVIRONMENT, DATABASE_URL are loaded here
 */
dotenv.config();

/**
 * Initialize Pino logger for structured JSON logging
 * 
 * Features:
 * - Structured JSON output for parsing by log aggregation services
 * - Pretty printing in development for readability
 * - Color coding for different log levels
 * - Timestamp included in each log entry
 * 
 * Log levels in order of severity:
 * - fatal: 60 - Critical errors, process will crash
 * - error: 50 - Error conditions
 * - warn: 40 - Warning messages
 * - info: 30 - Informational messages
 * - debug: 20 - Debug information
 * - trace: 10 - Very detailed trace information
 */
const logger = pino({
  transport: {
    target: 'pino-pretty',
    options: {
      colorize: true,
      translateTime: 'SYS:standard'
    }
  }
});

/**
 * Initialize Express application
 * Creates the core HTTP server instance
 */
const app = express();

/**
 * ===========================
 * Global Middleware Configuration
 * ===========================
 * 
 * Middleware is applied in the order defined below.
 * Each middleware processes the request/response and may pass to next middleware.
 * Order matters! Security middleware should come first.
 */

/**
 * helmet() - Security HTTP Headers
 * 
 * Automatically sets security headers to protect against common attacks:
 * - X-Frame-Options: Prevents clickjacking
 * - X-Content-Type-Options: Prevents MIME type sniffing
 * - Strict-Transport-Security: Enforces HTTPS
 * - Content-Security-Policy: Prevents XSS attacks
 * - X-XSS-Protection: Legacy XSS protection
 */
app.use(helmet());

/**
 * compression() - Response Compression
 * 
 * Automatically gzip compresses responses larger than 1KB
 * Reduces bandwidth usage and improves client load times
 * Especially beneficial for large wallet summaries and transaction histories
 */
app.use(compression());

/**
 * bodyParser.json() - JSON Request Body Parser
 * 
 * Parses incoming requests with Content-Type: application/json
 * Automatically decodes JSON and populates req.body
 * All wallet operation parameters are sent as JSON
 */
app.use(bodyParser.json());

/**
 * bodyParser.urlencoded() - Form Data Parser
 * 
 * Parses incoming requests with Content-Type: application/x-www-form-urlencoded
 * Useful for HTML forms and legacy clients
 * extended: true allows for rich objects in URL encoding
 */
app.use(bodyParser.urlencoded({ extended: true }));

/**
 * morgan() - HTTP Request Logger
 * 
 * Logs all incoming HTTP requests with format:
 * remote-addr - remote-user [time] "method url http-version" status length
 * 
 * Example:
 * ::1 - - [06/Jun/2026 03:30:34] "POST /api/wallet/create HTTP/1.1" 201 287
 */
app.use(morgan('combined'));

/**
 * cors() - Cross-Origin Resource Sharing
 * 
 * Enables requests from different domains/origins
 * Essential for client applications on different domains
 * Allows browsers to make requests to this API
 */
app.use(cors());

/**
 * ===========================
 * Utility Functions
 * ===========================
 */

/**
 * asyncHandler - Error handling wrapper for async route handlers
 * 
 * Express doesn't automatically catch errors in async/await functions
 * This wrapper catches any errors and passes them to the error handler
 * 
 * Usage:
 * app.get('/api/endpoint', asyncHandler(async (req, res) => {
 *   // Any errors thrown here are automatically caught
 * }))
 * 
 * @param {Function} fn - Async route handler function
 * @returns {Function} Wrapped function with error handling
 */
const asyncHandler = (fn) => (req, res, next) => {
  Promise.resolve(fn(req, res, next)).catch(next);
};

/**
 * ===========================
 * Data Storage
 * ===========================
 */

/**
 * In-memory wallet storage
 * 
 * In development/testing, wallets are stored in memory (Map)
 * In production, this should be replaced with a database like:
 * - MongoDB for flexible schema
 * - PostgreSQL for relational data
 * - Redis for caching
 * 
 * Current implementation:
 * - Key: walletId (UUID string)
 * - Value: BitcoinWallet instance
 * - Lost on server restart (for testing only)
 * 
 * Note: DO NOT use this approach in production!
 */
const wallets = new Map();

/**
 * ===========================
 * Route Handlers - Wallet Management
 * ===========================
 */

/**
 * @route POST /api/wallet/create
 * @desc Create a new Bitcoin wallet with optional initial balance
 * 
 * Request Body:
 * {
 *   "walletName": "MyWallet",           // Required: Wallet name/identifier
 *   "walletType": "hd_wallet",          // Optional: Type of wallet (default: hd_wallet)
 *   "initialBalance": 5.0               // Optional: Initial balance in BTC (default: 0)
 * }
 * 
 * Response (201 Created):
 * {
 *   "success": true,
 *   "message": "Wallet created successfully",
 *   "wallet": {
 *     "walletId": "uuid-string",
 *     "walletName": "MyWallet",
 *     "primaryAddress": "1A1z7agoat...",
 *     "balanceBTC": 5.0,
 *     "totalAddresses": 1,
 *     "totalTransactions": 0,
 *     "totalLightningChannels": 0
 *   }
 * }
 * 
 * @access Public
 * @throws 400 - Missing required walletName parameter
 * @throws 500 - Server error during wallet creation
 */
app.post('/api/wallet/create', asyncHandler(async (req, res) => {
  const { walletName, walletType = 'hd_wallet', initialBalance = 0 } = req.body;

  // Validate required parameters before processing
  if (!walletName) {
    logger.warn('Wallet creation failed: missing walletName');
    return res.status(400).json({ error: 'Wallet name is required' });
  }

  try {
    // Create new wallet instance using BitcoinWallet class
    const wallet = new BitcoinWallet(walletName, walletType, initialBalance);
    
    // Store wallet in memory with walletId as key for fast retrieval
    wallets.set(wallet.walletId, wallet);

    // Log successful wallet creation with timestamp
    logger.info(`[Wallet Created] ID: ${wallet.walletId}, Name: ${walletName}`);

    // Return wallet summary with 201 Created status
    res.status(201).json({
      success: true,
      message: 'Wallet created successfully',
      wallet: wallet.getWalletSummary()
    });
  } catch (error) {
    // Log error with full context for debugging
    logger.error(`[Wallet Creation Error] ${error.message}`);
    res.status(500).json({ error: 'Failed to create wallet' });
  }
}));

/**
 * @route GET /api/wallet/:walletId
 * @desc Get complete wallet information including all metadata
 * 
 * URL Parameters:
 * - walletId: UUID of the wallet to retrieve
 * 
 * Response (200 OK):
 * {
 *   "success": true,
 *   "wallet": {
 *     "walletId": "uuid-string",
 *     "walletName": "MyWallet",
 *     "walletType": "hd_wallet",
 *     "primaryAddress": "1A1z7agoat...",
 *     "totalAddresses": 3,
 *     "balanceBTC": 4.99,
 *     "totalTransactions": 2,
 *     "totalLightningChannels": 1,
 *     "totalLightningCapacityMBTC": 1000,
 *     "createdAt": "2026-06-06T03:30:34.123Z"
 *   }
 * }
 * 
 * @access Public
 * @throws 404 - Wallet with given ID not found
 */
app.get('/api/wallet/:walletId', asyncHandler(async (req, res) => {
  const { walletId } = req.params;

  // Look up wallet in storage
  const wallet = wallets.get(walletId);
  
  if (!wallet) {
    logger.warn(`[Wallet Not Found] ID: ${walletId}`);
    return res.status(404).json({ error: 'Wallet not found' });
  }

  // Return complete wallet summary
  res.json({
    success: true,
    wallet: wallet.getWalletSummary()
  });
}));

/**
 * @route GET /api/wallet/:walletId/balance
 * @desc Get current wallet balance
 * 
 * URL Parameters:
 * - walletId: UUID of the wallet
 * 
 * Response (200 OK):
 * {
 *   "success": true,
 *   "walletId": "uuid-string",
 *   "balance": 4.99,
 *   "currency": "BTC"
 * }
 * 
 * Use Cases:
 * - Quick balance check in UI
 * - Low-latency balance polling
 * - Mobile app balance display
 * 
 * @access Public
 * @throws 404 - Wallet not found
 */
app.get('/api/wallet/:walletId/balance', asyncHandler(async (req, res) => {
  const { walletId } = req.params;

  const wallet = wallets.get(walletId);
  if (!wallet) {
    return res.status(404).json({ error: 'Wallet not found' });
  }

  res.json({
    success: true,
    walletId,
    balance: wallet.getBalance(),
    currency: 'BTC'
  });
}));

/**
 * @route GET /api/wallet/:walletId/addresses
 * @desc Get all addresses in the wallet
 * 
 * URL Parameters:
 * - walletId: UUID of the wallet
 * 
 * Response (200 OK):
 * {
 *   "success": true,
 *   "addresses": [
 *     "1A1z7agoat2FACAEY6bnQnguWEPhNrn7d",
 *     "1BvBMSEYstWetqTFn5Au4m4GFg7xJaNVN2",
 *     "1JqDybxboutNHRZuk2QBPQmRn8JR38V1g"
 *   ],
 *   "total": 3
 * }
 * 
 * HD Wallet Advantage:
 * - Generate infinite addresses from master seed
 * - Each address is unique but derived from the same seed
 * - Improves privacy by using different address per transaction
 * 
 * @access Public
 * @throws 404 - Wallet not found
 */
app.get('/api/wallet/:walletId/addresses', asyncHandler(async (req, res) => {
  const { walletId } = req.params;

  const wallet = wallets.get(walletId);
  if (!wallet) {
    return res.status(404).json({ error: 'Wallet not found' });
  }

  res.json({
    success: true,
    addresses: wallet.getAllAddresses(),
    total: wallet.addresses.length
  });
}));

/**
 * ===========================
 * Route Handlers - Transaction Management
 * ===========================
 */

/**
 * @route POST /api/transaction/send
 * @desc Send Bitcoin transaction from wallet with dynamic fee calculation
 * 
 * Request Body:
 * {
 *   "walletId": "uuid-string",          // Required: Source wallet
 *   "toAddress": "1A1z7agoat...",       // Required: Recipient's Bitcoin address
 *   "amount": 1.5,                      // Required: Amount in BTC
 *   "priority": "high"                  // Optional: Fee priority (low/medium/high)
 * }
 * 
 * Fee Calculation:
 * - low:    1 sat/byte    → ~1-2 hours confirmation   → 0.00000250 BTC
 * - medium: 5 sat/byte    → ~10-30 min confirmation   → 0.00001250 BTC
 * - high:   10 sat/byte   → ~5-10 min confirmation    → 0.00002500 BTC
 * 
 * Response (201 Created):
 * {
 *   "success": true,
 *   "message": "Transaction sent successfully",
 *   "transaction": {
 *     "txId": "uuid-string",
 *     "fromAddress": "1A1z7agoat...",
 *     "toAddress": "1BvBMSEYstWetqTFn5Au4m4GFg7xJaNVN2",
 *     "amount": 1.5,
 *     "fee": 0.0000125,
 *     "status": "pending",
 *     "timestamp": "2026-06-06T03:30:34.123Z",
 *     "confirmations": 0,
 *     "isStuck": false
 *   }
 * }
 * 
 * @access Public
 * @throws 400 - Missing required parameters or insufficient balance
 * @throws 404 - Wallet not found
 * @throws 500 - Server error during transaction
 */
app.post('/api/transaction/send', asyncHandler(async (req, res) => {
  const { walletId, toAddress, amount, priority = 'medium' } = req.body;

  // Validate all required parameters are provided
  if (!walletId || !toAddress || !amount) {
    logger.warn('[Transaction Send] Missing required parameters');
    return res.status(400).json({
      error: 'Missing required fields: walletId, toAddress, amount'
    });
  }

  // Look up wallet in storage
  const wallet = wallets.get(walletId);
  if (!wallet) {
    return res.status(404).json({ error: 'Wallet not found' });
  }

  try {
    // Attempt to send transaction through wallet
    // Returns null if insufficient balance or other error
    const transaction = wallet.sendTransaction(toAddress, amount, priority);

    if (!transaction) {
      logger.warn(`[Transaction Send] Failed: Insufficient balance`);
      return res.status(400).json({ 
        error: 'Transaction failed - insufficient balance' 
      });
    }

    // Log successful transaction
    logger.info(`[Transaction Sent] ID: ${transaction.txId}, Amount: ${amount} BTC`);

    // Return transaction details with 201 status
    res.status(201).json({
      success: true,
      message: 'Transaction sent successfully',
      transaction: transaction.toJSON()
    });
  } catch (error) {
    logger.error(`[Transaction Send Error] ${error.message}`);
    res.status(500).json({ error: 'Failed to send transaction' });
  }
}));

/**
 * @route GET /api/transaction/:walletId/history
 * @desc Get transaction history for a wallet with optional limit
 * 
 * URL Parameters:
 * - walletId: UUID of the wallet
 * 
 * Query Parameters:
 * - limit: (Optional) Maximum number of transactions to return
 *          If not provided, returns all transactions
 *          Example: /api/transaction/xyz/history?limit=10
 * 
 * Response (200 OK):
 * {
 *   "success": true,
 *   "transactions": [
 *     {
 *       "txId": "uuid-1",
 *       "fromAddress": "1A1z7agoat...",
 *       "toAddress": "1BvBMSEYstWetqTFn5Au4m4GFg7xJaNVN2",
 *       "amount": 1.5,
 *       "fee": 0.0000125,
 *       "status": "confirmed",
 *       "timestamp": "2026-06-06T03:30:34.123Z",
 *       "confirmations": 6,
 *       "isStuck": false
 *     },
 *     { ... more transactions ... }
 *   ],
 *   "total": 15
 * }
 * 
 * Use Cases:
 * - Display transaction history in UI
 * - Audit trail for account reconciliation
 * - Tax reporting on transaction history
 * 
 * @access Public
 * @throws 404 - Wallet not found
 */
app.get('/api/transaction/:walletId/history', asyncHandler(async (req, res) => {
  const { walletId } = req.params;
  const { limit } = req.query;

  const wallet = wallets.get(walletId);
  if (!wallet) {
    return res.status(404).json({ error: 'Wallet not found' });
  }

  // Get transaction history with optional limit
  // If limit is provided, convert from string to integer
  const transactions = wallet.getTransactionHistory(
    limit ? parseInt(limit) : null
  );

  res.json({
    success: true,
    transactions,
    total: transactions.length
  });
}));

/**
 * @route POST /api/transaction/:walletId/accelerate
 * @desc Accelerate stuck transaction using Replace-By-Fee (RBF)
 * 
 * When a transaction is broadcast with low fees and sits in the mempool
 * without confirming for hours, it's considered "stuck". This endpoint
 * allows bumping the fee by creating a new transaction that spends the
 * same inputs but with higher fees, replacing the original in the mempool.
 * 
 * URL Parameters:
 * - walletId: UUID of the wallet
 * 
 * Request Body:
 * {
 *   "txId": "uuid-string",              // Required: Transaction ID to accelerate
 *   "additionalFee": 0.0000050          // Required: Additional fee in BTC
 * }
 * 
 * Response (200 OK):
 * {
 *   "success": true,
 *   "message": "Transaction accelerated successfully",
 *   "txId": "uuid-string",
 *   "additionalFee": 0.0000050
 * }
 * 
 * Requirements:
 * - Transaction must be in PENDING status
 * - Wallet must have sufficient balance for additional fee
 * - Bitcoin network must support RBF (standard on most nodes)
 * 
 * @access Public
 * @throws 400 - Missing parameters, invalid transaction, or insufficient balance
 * @throws 404 - Wallet not found
 * @throws 500 - Server error
 */
app.post('/api/transaction/:walletId/accelerate', asyncHandler(async (req, res) => {
  const { walletId } = req.params;
  const { txId, additionalFee } = req.body;

  // Validate required parameters
  if (!txId || !additionalFee) {
    logger.warn('[Transaction Accelerate] Missing required parameters');
    return res.status(400).json({
      error: 'Missing required fields: txId, additionalFee'
    });
  }

  const wallet = wallets.get(walletId);
  if (!wallet) {
    return res.status(404).json({ error: 'Wallet not found' });
  }

  try {
    // Attempt to accelerate transaction
    const success = wallet.accelerateStuckTransaction(txId, additionalFee);

    if (!success) {
      logger.warn(`[Transaction Accelerate] Failed for TX: ${txId}`);
      return res.status(400).json({
        error: 'Failed to accelerate transaction - invalid status or insufficient balance'
      });
    }

    logger.info(`[Transaction Accelerated] TX: ${txId}, Additional Fee: ${additionalFee}`);

    res.json({
      success: true,
      message: 'Transaction accelerated successfully',
      txId,
      additionalFee
    });
  } catch (error) {
    logger.error(`[Transaction Accelerate Error] ${error.message}`);
    res.status(500).json({ error: 'Failed to accelerate transaction' });
  }
}));

/**
 * ===========================
 * Route Handlers - Lightning Network
 * ===========================
 */

/**
 * @route POST /api/lightning/channel/create
 * @desc Create a new Lightning Network payment channel
 * 
 * Lightning Network enables instant, off-chain payments with minimal fees.
 * A channel must be funded with Bitcoin and opened with a peer before payments.
 * 
 * Request Body:
 * {
 *   "walletId": "uuid-string",          // Required: Funding wallet
 *   "channelId": "ch_001",              // Required: Channel identifier
 *   "capacity": 1000                    // Required: Channel capacity in mBTC
 * }
 * 
 * Capacity Breakdown:
 * - 1000 mBTC = 0.001 BTC = ~$30 (approximate)
 * - Half allocated to local balance (funds you can send)
 * - Half allocated to remote balance (funds peer can receive)
 * 
 * Response (201 Created):
 * {
 *   "success": true,
 *   "message": "Lightning channel created successfully",
 *   "channel": {
 *     "channelId": "ch_001",
 *     "capacity": 1000,
 *     "localBalance": 500,
 *     "remoteBalance": 500,
 *     "status": "active",
 *     "createdAt": "2026-06-06T03:30:34.123Z",
 *     "transactionCount": 0
 *   }
 * }
 * 
 * Channel States:
 * - "active": Channel is open and can process payments
 * - "closed": Channel has been closed and settled on-chain
 * - "pending": Channel creation is pending on-chain confirmation
 * 
 * @access Public
 * @throws 400 - Missing parameters or insufficient balance
 * @throws 404 - Wallet not found
 * @throws 500 - Server error
 */
app.post('/api/lightning/channel/create', asyncHandler(async (req, res) => {
  const { walletId, channelId, capacity } = req.body;

  // Validate all required parameters
  if (!walletId || !channelId || !capacity) {
    logger.warn('[Lightning Channel Create] Missing required parameters');
    return res.status(400).json({
      error: 'Missing required fields: walletId, channelId, capacity'
    });
  }

  const wallet = wallets.get(walletId);
  if (!wallet) {
    return res.status(404).json({ error: 'Wallet not found' });
  }

  try {
    // Create Lightning channel through wallet
    const channel = wallet.createLightningChannel(channelId, capacity);

    if (!channel) {
      logger.warn(`[Lightning Channel Create] Failed: Insufficient balance`);
      return res.status(400).json({
        error: 'Failed to create channel - insufficient balance'
      });
    }

    logger.info(`[Lightning Channel Created] ID: ${channelId}, Capacity: ${capacity} mBTC`);

    res.status(201).json({
      success: true,
      message: 'Lightning channel created successfully',
      channel: channel.toJSON()
    });
  } catch (error) {
    logger.error(`[Lightning Channel Create Error] ${error.message}`);
    res.status(500).json({ error: 'Failed to create Lightning channel' });
  }
}));

/**
 * ===========================
 * Route Handlers - System Monitoring
 * ===========================
 */

/**
 * @route GET /api/health
 * @desc Health check endpoint for monitoring and load balancers
 * 
 * Response (200 OK):
 * {
 *   "status": "healthy",
 *   "version": "1.0.0",
 *   "timestamp": "2026-06-06T03:30:34.123Z"
 * }
 * 
 * Use Cases:
 * - Kubernetes liveness probe
 * - Load balancer health check
 * - Uptime monitoring services
 * - Docker healthcheck
 * 
 * Quick response time indicates server is running properly
 * 
 * @access Public
 */
app.get('/api/health', (req, res) => {
  res.json({
    status: 'healthy',
    version: '1.0.0',
    timestamp: new Date().toISOString()
  });
});

/**
 * @route GET /api/stats
 * @desc Get platform-wide statistics aggregated across all wallets
 * 
 * Response (200 OK):
 * {
 *   "success": true,
 *   "stats": {
 *     "totalWallets": 42,
 *     "totalBalance": 125.50,
 *     "totalTransactions": 1247,
 *     "totalLightningChannels": 89
 *   }
 * }
 * 
 * Metrics Explained:
 * - totalWallets: Number of wallets created on this server
 * - totalBalance: Sum of all wallet balances in BTC
 * - totalTransactions: Total transaction count across all wallets
 * - totalLightningChannels: Total Lightning channels opened
 * 
 * Use Cases:
 * - Dashboard metrics
 * - Performance monitoring
 * - Capacity planning
 * - System utilization tracking
 * 
 * @access Public
 */
app.get('/api/stats', (req, res) => {
  let totalBalance = 0;
  let totalTransactions = 0;
  let totalChannels = 0;

  // Iterate through all wallets and aggregate statistics
  wallets.forEach(wallet => {
    totalBalance += wallet.getBalance();
    totalTransactions += wallet.transactions.length;
    totalChannels += Object.keys(wallet.channels).length;
  });

  res.json({
    success: true,
    stats: {
      totalWallets: wallets.size,
      totalBalance,
      totalTransactions,
      totalLightningChannels: totalChannels
    }
  });
});

/**
 * ===========================
 * Error Handlers
 * ===========================
 */

/**
 * 404 Not Found Handler
 * 
 * Catches all requests to undefined routes
 * Must be defined after all other routes
 */
app.use((req, res) => {
  logger.warn(`[404 Not Found] ${req.method} ${req.path}`);
  res.status(404).json({
    error: 'Not found',
    path: req.path
  });
});

/**
 * Global Error Handler
 * 
 * Catches all unhandled errors in the application
 * Must be the last middleware defined
 * 
 * Error handling strategy:
 * - Log error with full context for debugging
 * - Send generic error message in production
 * - Send detailed error message in development
 * - Always respond with 500 status
 */
app.use((error, req, res, next) => {
  logger.error(`[Global Error Handler] ${error.message}`);
  logger.error(`[Stack Trace] ${error.stack}`);
  
  res.status(500).json({
    error: 'Internal server error',
    message: process.env.NODE_ENV === 'production' ? 
      'An error occurred' : 
      error.message
  });
});

/**
 * ===========================
 * Server Startup
 * ===========================
 */

/**
 * Start Express server and begin listening for requests
 * 
 * Process:
 * 1. Read PORT from environment variables or use default 3000
 * 2. Call app.listen() to start HTTP server
 * 3. Log startup information with timestamp
 * 4. Server is now ready to accept requests
 * 
 * Startup Information Logged:
 * - Server port
 * - Environment (development/production)
 * - Application version
 * - Timestamp of startup
 */
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  logger.info(`🚀 Lighting Core Wallet Server running on port ${PORT}`);
  logger.info(`Environment: ${process.env.NODE_ENV || 'development'}`);
  logger.info(`Version: 1.0.0`);
  logger.info(`Timestamp: ${new Date().toISOString()}`);
});

// Export app for testing with frameworks like Supertest
module.exports = app;
