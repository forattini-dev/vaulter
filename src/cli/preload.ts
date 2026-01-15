/**
 * Preload module - runs before any other imports
 * Prevents MaxListenersExceededWarning from s3db.js dependencies
 */

process.setMaxListeners(50)
