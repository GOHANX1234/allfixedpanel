import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Set up data directory based on environment
const DATA_DIR = process.env.NODE_ENV === 'production' && process.env.RENDER 
  ? path.join(process.cwd(), 'data')  // Use a relative path that we can write to
  : path.join(process.cwd(), 'data');

// Define file paths
const ADMIN_FILE = path.join(DATA_DIR, 'admin.json');
const RESELLERS_FILE = path.join(DATA_DIR, 'resellers.json');
const TOKENS_FILE = path.join(DATA_DIR, 'tokens.json');
const KEYS_FILE = path.join(DATA_DIR, 'keys.json');
const DEVICES_FILE = path.join(DATA_DIR, 'devices.json');

// Initialize with default data if files don't exist
function initializeFiles() {
  try {
    // Create data directory if it doesn't exist
    if (!fs.existsSync(DATA_DIR)) {
      console.log(`Creating data directory at: ${DATA_DIR}`);
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    
    // Admin file
    if (!fs.existsSync(ADMIN_FILE)) {
      console.log(`Creating admin file at: ${ADMIN_FILE}`);
      fs.writeFileSync(ADMIN_FILE, JSON.stringify([
        { id: 1, username: 'admin', password: 'admin' }
      ], null, 2));
    }
    
    // Resellers file
    if (!fs.existsSync(RESELLERS_FILE)) {
      console.log(`Creating resellers file at: ${RESELLERS_FILE}`);
      fs.writeFileSync(RESELLERS_FILE, JSON.stringify([], null, 2));
    }
    
    // Tokens file
    if (!fs.existsSync(TOKENS_FILE)) {
      console.log(`Creating tokens file at: ${TOKENS_FILE}`);
      fs.writeFileSync(TOKENS_FILE, JSON.stringify([], null, 2));
    }
    
    // Keys file
    if (!fs.existsSync(KEYS_FILE)) {
      console.log(`Creating keys file at: ${KEYS_FILE}`);
      fs.writeFileSync(KEYS_FILE, JSON.stringify([], null, 2));
    }
    
    // Devices file
    if (!fs.existsSync(DEVICES_FILE)) {
      console.log(`Creating devices file at: ${DEVICES_FILE}`);
      fs.writeFileSync(DEVICES_FILE, JSON.stringify([], null, 2));
    }
    
    console.log("File initialization completed successfully");
  } catch (error) {
    console.error(`Error initializing files: ${error.message}`);
    console.error(`Data directory path: ${DATA_DIR}`);
    console.error(`Current working directory: ${process.cwd()}`);
    console.error(`Environment: ${process.env.NODE_ENV}`);
    console.error(`Render environment: ${process.env.RENDER ? 'true' : 'false'}`);
  }
}

// Initialize files on load
initializeFiles();

// Helper functions
function readJsonFile(file) {
  try {
    // Make sure DATA_DIR exists
    if (!fs.existsSync(DATA_DIR)) {
      console.log(`Creating data directory at: ${DATA_DIR}`);
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    
    if (!fs.existsSync(file)) {
      console.error(`File does not exist: ${file}`);
      return [];
    }
    
    const data = fs.readFileSync(file, 'utf8');
    
    try {
      return JSON.parse(data);
    } catch (parseError) {
      console.error(`JSON parse error for file ${file}: ${parseError.message}`);
      console.error(`File content: ${data.substring(0, 100)}${data.length > 100 ? '...' : ''}`);
      return [];
    }
  } catch (error) {
    console.error(`Error reading file ${file}: ${error.message}`);
    console.error(`Current working directory: ${process.cwd()}`);
    console.error(`Data directory path: ${DATA_DIR}`);
    return [];
  }
}

function writeJsonFile(file, data) {
  try {
    // Make sure DATA_DIR exists
    if (!fs.existsSync(DATA_DIR)) {
      console.log(`Creating data directory at: ${DATA_DIR}`);
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    
    // Create parent directories if they don't exist
    const dirPath = path.dirname(file);
    if (!fs.existsSync(dirPath)) {
      console.log(`Creating directory: ${dirPath}`);
      fs.mkdirSync(dirPath, { recursive: true });
    }
    
    fs.writeFileSync(file, JSON.stringify(data, null, 2));
    return true;
  } catch (error) {
    console.error(`Error writing file ${file}: ${error.message}`);
    console.error(`Current working directory: ${process.cwd()}`);
    console.error(`Data directory path: ${DATA_DIR}`);
    return false;
  }
}

// Get reseller specific file path
function getResellerFilePath(username) {
  return path.join(DATA_DIR, `${username}.json`);
}

// Create or update reseller file
function updateResellerFile(reseller, keys = []) {
  try {
    // Make sure the DATA_DIR exists
    if (!fs.existsSync(DATA_DIR)) {
      console.log(`Creating data directory at: ${DATA_DIR}`);
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    
    const filePath = getResellerFilePath(reseller.username);
    console.log(`Working with reseller file: ${filePath}`);
    
    let resellerData = {
      resellerId: reseller.id,
      username: reseller.username,
      credits: reseller.credits || 0,
      registrationDate: reseller.registrationDate || new Date().toISOString(),
      keys: []
    };
    
    // If file exists, read it first to preserve existing data
    if (fs.existsSync(filePath)) {
      try {
        const data = fs.readFileSync(filePath, 'utf8');
        console.log(`Read reseller file for: ${reseller.username}`);
        const existingData = JSON.parse(data);
        resellerData = { ...existingData };
        
        // If new keys are provided, add them
        if (keys && keys.length > 0) {
          // Format date objects to strings before saving to JSON
          const formattedKeys = keys.map(key => ({
            ...key,
            createdAt: key.createdAt ? new Date(key.createdAt).toISOString() : new Date().toISOString(),
            expiryDate: key.expiryDate ? new Date(key.expiryDate).toISOString() : null
          }));
          
          resellerData.keys = [...(resellerData.keys || []), ...formattedKeys];
        }
        
        // Update reseller info
        resellerData.credits = reseller.credits || resellerData.credits || 0;
      } catch (error) {
        console.error(`Error reading reseller file ${filePath}: ${error.message}`);
        console.error(`Will create a new file for reseller: ${reseller.username}`);
      }
    } else {
      console.log(`Creating new reseller file for: ${reseller.username}`);
      // If file doesn't exist, initialize with the provided keys
      if (keys && keys.length > 0) {
        // Format date objects to strings before saving to JSON
        const formattedKeys = keys.map(key => ({
          ...key,
          createdAt: key.createdAt ? new Date(key.createdAt).toISOString() : new Date().toISOString(),
          expiryDate: key.expiryDate ? new Date(key.expiryDate).toISOString() : null
        }));
        
        resellerData.keys = formattedKeys;
      }
    }
    
    // Write the data back to the file
    fs.writeFileSync(filePath, JSON.stringify(resellerData, null, 2));
    console.log(`Updated reseller file for: ${reseller.username}`);
    return true;
  } catch (error) {
    console.error(`Error in updateResellerFile for ${reseller?.username || 'unknown'}: ${error.message}`);
    console.error(`Data directory path: ${DATA_DIR}`);
    console.error(`Environment: ${process.env.NODE_ENV}`);
    return false;
  }
}

// Export the functions
export {
  readJsonFile,
  writeJsonFile,
  getResellerFilePath,
  updateResellerFile,
  ADMIN_FILE,
  RESELLERS_FILE,
  TOKENS_FILE,
  KEYS_FILE,
  DEVICES_FILE
};
