import type { Express, Request, Response } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { 
  insertAdminSchema,
  insertResellerSchema, 
  insertKeySchema, 
  keyVerificationSchema, 
  addCreditsSchema,
  gameEnum,
  insertOnlineUpdateSchema,
  updateOnlineUpdateSchema
} from "@shared/schema";
import { nanoid } from "nanoid";
import session from "express-session";
import MemoryStore from "memorystore";
import passport from "passport";
import { Strategy as LocalStrategy } from "passport-local";
import fs from "fs";
import path from "path";

// Import our direct JSON database utility
import * as db from './direct-db.mjs';

export async function registerRoutes(app: Express): Promise<Server> {
  // Ensure data directory exists for reseller files
  const dataDir = path.join('.', 'data');
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
    console.log('Created data directory for reseller files');
  }

  // Set up session middleware
  const SessionStore = MemoryStore(session);
  
  // Check if we're in a production environment
  const isProduction = process.env.NODE_ENV === "production";
  
  console.log("Session configuration:", {
    production: isProduction,
    secureCookie: process.env.COOKIE_SECURE,
    sameSiteCookie: process.env.COOKIE_SAME_SITE
  });
  
  // Set up session with different options based on environment
  const isSecure = process.env.COOKIE_SECURE === "true" || isProduction;
  
  // For SameSite configuration
  // Use 'lax' for better CSRF protection - blocks cross-site requests with credentials
  // while still allowing same-site requests and top-level navigation
  const sameSiteOption: boolean | 'lax' | 'strict' | 'none' | undefined = 'lax';

  // Handle domain for production
  const cookieDomain = isProduction && process.env.PUBLIC_URL 
    ? new URL(process.env.PUBLIC_URL).hostname 
    : undefined;

  // Set up session config
  const sessionConfig: session.SessionOptions = {
    secret: process.env.SESSION_SECRET || "keymaster-secret",
    // Setting resave to true to ensure session stays alive
    resave: true, 
    // We need this for the initial session to be saved
    saveUninitialized: true,
    store: new SessionStore({
      checkPeriod: 86400000 // 24 hours
    }),
    cookie: {
      // Must be false for localhost, true for production HTTPS
      secure: isSecure,
      
      // Set to a longer max age (7 days)
      maxAge: 7 * 24 * 60 * 60 * 1000,
      
      // Standard path
      path: "/",
      
      // Set domain conditionally (only in production)
      ...(cookieDomain ? { domain: cookieDomain } : {}),
      
      // Handle sameSite setting
      sameSite: sameSiteOption,
      
      // Secure cookie access - prevent XSS attacks
      httpOnly: true
    },
    // Add proxy trust for production environments
    proxy: isProduction
  };
  
  // Log session configuration
  console.log("Applied session cookie configuration:", {
    secure: sessionConfig.cookie?.secure,
    sameSite: sessionConfig.cookie?.sameSite,
    domain: sessionConfig.cookie?.domain,
    httpOnly: sessionConfig.cookie?.httpOnly,
    production: isProduction
  });
  
  app.use(session(sessionConfig));

  // Set up passport authentication
  app.use(passport.initialize());
  app.use(passport.session());

  // Configure passport strategies
  passport.use('admin', new LocalStrategy(async (username, password, done) => {
    try {
      const admin = await storage.getAdminByUsername(username);
      if (!admin) {
        return done(null, false, { message: 'Incorrect username or password' });
      }
      if (admin.password !== password) {
        return done(null, false, { message: 'Incorrect username or password' });
      }
      return done(null, { id: admin.id, username: admin.username, role: 'admin' });
    } catch (err) {
      return done(err);
    }
  }));

  passport.use('reseller', new LocalStrategy(async (username, password, done) => {
    try {
      const reseller = await storage.getResellerByUsername(username);
      if (!reseller) {
        return done(null, false, { message: 'Incorrect username or password' });
      }
      if (reseller.password !== password) {
        return done(null, false, { message: 'Incorrect username or password' });
      }
      if (!reseller.isActive) {
        return done(null, false, { message: 'Account is suspended' });
      }
      return done(null, { id: reseller.id, username: reseller.username, role: 'reseller' });
    } catch (err) {
      return done(err);
    }
  }));

  passport.serializeUser((user: any, done) => {
    console.log("Serializing user:", user);
    done(null, JSON.stringify(user));
  });

  passport.deserializeUser((serializedUser: string, done) => {
    try {
      const user = JSON.parse(serializedUser);
      console.log("Deserialized user:", user);
      done(null, user);
    } catch (error) {
      console.error("Error deserializing user:", error);
      done(error, null);
    }
  });

  // Auth middleware
  const isAuthenticated = (req: Request, res: Response, next: Function) => {
    if (req.isAuthenticated()) {
      return next();
    }
    res.status(401).json({ message: 'Unauthorized' });
  };

  const isAdmin = (req: Request, res: Response, next: Function) => {
    if (req.isAuthenticated() && (req.user as any).role === 'admin') {
      return next();
    }
    res.status(403).json({ message: 'Forbidden' });
  };

  const isReseller = (req: Request, res: Response, next: Function) => {
    if (req.isAuthenticated() && (req.user as any).role === 'reseller') {
      return next();
    }
    res.status(403).json({ message: 'Forbidden' });
  };

  // CSRF protection middleware for admin write endpoints
  const csrfProtection = (req: Request, res: Response, next: Function) => {
    // Get the expected origin from environment or default to the request host
    const isProduction = process.env.NODE_ENV === "production";
    let expectedOrigin: string;
    
    if (isProduction && process.env.PUBLIC_URL) {
      expectedOrigin = process.env.PUBLIC_URL.replace(/\/$/, ''); // Remove trailing slash
    } else {
      // In development, construct from request
      expectedOrigin = `${req.protocol}://${req.get('host')}`;
    }
    
    // Check Origin header first (preferred)
    const origin = req.get('Origin');
    if (origin) {
      if (origin !== expectedOrigin) {
        console.warn(`CSRF: Invalid origin - expected: ${expectedOrigin}, received: ${origin}`);
        return res.status(403).json({ message: 'Forbidden: Invalid origin' });
      }
    } else {
      // Fallback to Referer header if Origin is not present
      const referer = req.get('Referer');
      if (!referer) {
        console.warn('CSRF: No Origin or Referer header found');
        return res.status(403).json({ message: 'Forbidden: No origin header' });
      }
      
      try {
        const refererUrl = new URL(referer);
        const refererOrigin = `${refererUrl.protocol}//${refererUrl.host}`;
        
        if (refererOrigin !== expectedOrigin) {
          console.warn(`CSRF: Invalid referer - expected: ${expectedOrigin}, received: ${refererOrigin}`);
          return res.status(403).json({ message: 'Forbidden: Invalid referer' });
        }
      } catch (error) {
        console.warn('CSRF: Invalid referer header format');
        return res.status(403).json({ message: 'Forbidden: Invalid referer format' });
      }
    }
    
    next();
  };

  // Combined middleware for admin write operations (CSRF + auth)
  const adminWriteProtection = [isAdmin, csrfProtection];

  // Function to log authentication process
  const logAuthProcess = (method: string, user: any, session: any) => {
    console.log(`==== Auth process for ${method} ====`);
    console.log('User:', user);
    console.log('Session ID:', session?.id);
    console.log('Session cookie:', session?.cookie);
    console.log('==== End auth process ====');
  }

  // Auth routes
  app.post('/api/auth/admin/login', (req, res, next) => {
    console.log('Admin login attempt:', req.body.username);
    
    passport.authenticate('admin', (err, user, info) => {
      if (err) {
        console.error('Auth error:', err);
        return next(err);
      }
      if (!user) {
        console.log('Auth failed:', info.message);
        return res.status(401).json({ message: info.message });
      }
      
      req.logIn(user, (err) => {
        if (err) {
          console.error('Login error:', err);
          return next(err);
        }
        
        logAuthProcess('admin', user, req.session);
        return res.json({ user });
      });
    })(req, res, next);
  });

  app.post('/api/auth/reseller/login', (req, res, next) => {
    console.log('Reseller login attempt:', req.body.username);
    
    passport.authenticate('reseller', (err, user, info) => {
      if (err) {
        console.error('Auth error:', err);
        return next(err);
      }
      if (!user) {
        console.log('Auth failed:', info.message);
        return res.status(401).json({ message: info.message });
      }
      
      req.logIn(user, (err) => {
        if (err) {
          console.error('Login error:', err);
          return next(err);
        }
        
        logAuthProcess('reseller', user, req.session);
        return res.json({ user });
      });
    })(req, res, next);
  });

  app.post('/api/auth/logout', (req, res) => {
    req.logout(() => {
      res.json({ success: true });
    });
  });

  app.get('/api/auth/session', (req, res) => {
    // Security: Session check without logging sensitive cookie data
    console.log("Session check:", {
      isAuthenticated: req.isAuthenticated(),
      user: req.user || null,
      sessionID: req.sessionID
    });
    
    if (req.isAuthenticated()) {
      res.json({ isAuthenticated: true, user: req.user });
    } else {
      res.json({ isAuthenticated: false });
    }
  });
  
  // Debug endpoint for checking session state (production-safe)
  app.get('/api/auth/debug', (req, res) => {
    res.json({
      isAuthenticated: req.isAuthenticated(),
      sessionID: req.sessionID,
      user: req.user || null,
      userAgent: req.headers['user-agent'],
      timestamp: new Date().toISOString()
    });
  });
  
  // Simple test endpoint that doesn't require authentication
  app.get('/api/test', (req, res) => {
    res.json({
      message: "API is working",
      timestamp: new Date().toISOString(),
      environment: process.env.NODE_ENV,
      sessionID: req.sessionID,
      hasCookies: !!req.headers.cookie
    });
  });

  // Registration route
  app.post('/api/auth/reseller/register', async (req, res) => {
    try {
      const resellerData = insertResellerSchema.parse(req.body);
      
      // Check if username exists
      const existingReseller = await storage.getResellerByUsername(resellerData.username);
      if (existingReseller) {
        return res.status(400).json({ message: 'Username already exists' });
      }
      
      // Check if token exists and is not used
      const token = await storage.getToken(resellerData.referralToken);
      if (!token || token.isUsed) {
        return res.status(400).json({ message: 'Invalid or already used referral token' });
      }
      
      // Create reseller
      const reseller = await storage.createReseller(resellerData);
      
      // Mark token as used
      await storage.useToken(resellerData.referralToken, resellerData.username);
      
      // Create a JSON file for the reseller's keys using our utility
      try {
        // Use the utility to create the reseller's file
        db.updateResellerFile(reseller);
        console.log(`Created key file for reseller: ${reseller.username} using the DB utility`);
      } catch (fileError) {
        console.error(`Error creating reseller key file: ${fileError.message}`);
        // Continue even if file creation fails
      }
      
      res.status(201).json({ 
        success: true, 
        message: 'Registration successful',
        reseller: {
          id: reseller.id,
          username: reseller.username,
          credits: reseller.credits,
          registrationDate: reseller.registrationDate
        }
      });
    } catch (error) {
      res.status(400).json({ message: error.message });
    }
  });

  // Admin routes
  app.get('/api/admin/stats', isAdmin, async (req, res) => {
    try {
      const stats = await storage.getStats();
      res.json(stats);
    } catch (error) {
      res.status(500).json({ message: error.message });
    }
  });

  app.get('/api/admin/resellers', isAdmin, async (req, res) => {
    try {
      const resellers = await storage.getAllResellers();
      const resellersWithStats = await Promise.all(
        resellers.map(async (reseller) => {
          const keys = await storage.getKeysByResellerId(reseller.id);
          const now = new Date();
          const activeKeys = keys.filter(key => !key.isRevoked && new Date(key.expiryDate) > now).length;
          return {
            ...reseller,
            totalKeys: keys.length,
            activeKeys
          };
        })
      );
      res.json(resellersWithStats);
    } catch (error) {
      res.status(500).json({ message: error.message });
    }
  });
  
  // Get all keys for a specific reseller (admin view)
  app.get('/api/admin/resellers/:id/keys', isAuthenticated, isAdmin, async (req, res) => {
    try {
      const resellerId = parseInt(req.params.id);
      if (isNaN(resellerId)) {
        return res.status(400).json({ message: 'Invalid reseller ID' });
      }
      
      const keys = await storage.getKeysByResellerId(resellerId);
      
      // Get device counts for each key
      const keysWithDevices = await Promise.all(keys.map(async key => {
        const devices = await storage.getDevicesByKeyId(key.id);
        const now = new Date();
        let status = key.isRevoked ? "REVOKED" : 
                    (new Date(key.expiryDate) <= now ? "EXPIRED" : "ACTIVE");
        
        return {
          ...key,
          deviceCount: devices.length,
          status,
          devices: devices
        };
      }));
      
      res.json(keysWithDevices);
    } catch (error) {
      res.status(500).json({ message: error.message });
    }
  });
  
  // Admin route to revoke/delete a key
  app.delete('/api/admin/keys/:id', isAuthenticated, isAdmin, async (req, res) => {
    try {
      const keyId = parseInt(req.params.id);
      if (isNaN(keyId)) {
        return res.status(400).json({ message: 'Invalid key ID' });
      }
      
      const revokedKey = await storage.revokeKey(keyId);
      if (!revokedKey) {
        return res.status(404).json({ message: 'Key not found' });
      }
      
      res.json({ success: true, message: 'Key revoked successfully', key: revokedKey });
    } catch (error) {
      res.status(500).json({ message: error.message });
    }
  });

  app.post('/api/admin/resellers/credits', isAdmin, async (req, res) => {
    try {
      const { resellerId, amount } = addCreditsSchema.parse(req.body);
      
      const reseller = await storage.getReseller(resellerId);
      if (!reseller) {
        return res.status(404).json({ message: 'Reseller not found' });
      }
      
      const updatedReseller = await storage.updateResellerCredits(resellerId, amount);
      res.json({
        success: true,
        reseller: updatedReseller
      });
    } catch (error) {
      res.status(400).json({ message: error.message });
    }
  });

  app.post('/api/admin/resellers/:id/toggle-status', isAdmin, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const { isActive } = req.body;
      
      if (typeof isActive !== 'boolean') {
        return res.status(400).json({ message: 'isActive must be a boolean' });
      }
      
      const reseller = await storage.getReseller(id);
      if (!reseller) {
        return res.status(404).json({ message: 'Reseller not found' });
      }
      
      const updatedReseller = await storage.updateResellerStatus(id, isActive);
      res.json({
        success: true,
        reseller: updatedReseller
      });
    } catch (error) {
      res.status(500).json({ message: error.message });
    }
  });

  app.post('/api/admin/tokens/generate', isAdmin, async (req, res) => {
    try {
      const token = await storage.createToken();
      res.status(201).json({
        success: true,
        token
      });
    } catch (error) {
      res.status(500).json({ message: error.message });
    }
  });

  app.get('/api/admin/tokens', isAdmin, async (req, res) => {
    try {
      const tokens = await storage.getAllTokens();
      res.json(tokens);
    } catch (error) {
      res.status(500).json({ message: error.message });
    }
  });

  // Database backup routes
  app.get('/api/admin/backup/files', isAdmin, async (req, res) => {
    try {
      const dataDir = path.join('.', 'data');
      const files = fs.readdirSync(dataDir).filter(file => file.endsWith('.json'));
      
      const fileInfos = files.map(file => {
        const filePath = path.join(dataDir, file);
        const stats = fs.statSync(filePath);
        return {
          name: file,
          size: stats.size,
          modified: stats.mtime,
          downloadUrl: `/api/admin/backup/download/${encodeURIComponent(file)}`
        };
      });
      
      res.json(fileInfos);
    } catch (error) {
      res.status(500).json({ message: error.message });
    }
  });

  app.get('/api/admin/backup/download/:filename', isAdmin, async (req, res) => {
    try {
      const filename = req.params.filename;
      const dataDir = path.resolve('.', 'data');
      
      // Security: Get whitelist of allowed files from directory
      const allowedFiles = fs.readdirSync(dataDir).filter(file => file.endsWith('.json'));
      
      // Security check - ensure filename is in whitelist (prevents directory traversal)
      if (!allowedFiles.includes(filename)) {
        return res.status(404).json({ message: 'File not found' });
      }
      
      const filePath = path.join(dataDir, filename);
      
      // Additional security check - ensure resolved path is within data directory
      const resolvedPath = path.resolve(filePath);
      if (!resolvedPath.startsWith(dataDir)) {
        return res.status(404).json({ message: 'File not found' });
      }
      
      // Sanitize filename for Content-Disposition header
      const sanitizedFilename = filename.replace(/[^a-zA-Z0-9.-]/g, '_');
      
      // Use res.download for safer file serving
      res.download(filePath, sanitizedFilename, (err) => {
        if (err) {
          console.error('Download error:', err);
          if (!res.headersSent) {
            res.status(500).json({ message: 'Failed to download file' });
          }
        }
      });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.get('/api/admin/backup/download-all', isAdmin, async (req, res) => {
    try {
      const dataDir = path.join('.', 'data');
      const files = fs.readdirSync(dataDir).filter(file => file.endsWith('.json'));
      
      if (files.length === 0) {
        return res.status(404).json({ message: 'No backup files found' });
      }
      
      // Create a simple tar-like archive by combining all JSON files
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const archiveName = `dexter-backup-${timestamp}.json`;
      
      // Create combined backup object
      const backup = {
        timestamp: new Date().toISOString(),
        files: {} as Record<string, any>
      };
      
      files.forEach(file => {
        const filePath = path.join(dataDir, file);
        const content = JSON.parse(fs.readFileSync(filePath, 'utf8'));
        backup.files[file] = content;
      });
      
      res.setHeader('Content-Disposition', `attachment; filename="${archiveName}"`);
      res.setHeader('Content-Type', 'application/json');
      res.json(backup);
    } catch (error) {
      res.status(500).json({ message: error.message });
    }
  });

  // Online Update routes
  app.get('/api/admin/online-updates', isAdmin, async (req, res) => {
    try {
      const updates = await storage.getAllOnlineUpdates();
      res.json(updates);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.post('/api/admin/online-updates', adminWriteProtection, async (req, res) => {
    try {
      const updateData = insertOnlineUpdateSchema.parse(req.body);
      const update = await storage.createOnlineUpdate(updateData);
      res.status(201).json({
        success: true,
        update
      });
    } catch (error: any) {
      res.status(400).json({ message: error.message });
    }
  });

  app.get('/api/admin/online-updates/:id', isAdmin, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) {
        return res.status(400).json({ message: 'Invalid update ID' });
      }
      
      const update = await storage.getOnlineUpdate(id);
      if (!update) {
        return res.status(404).json({ message: 'Update not found' });
      }
      
      res.json(update);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.put('/api/admin/online-updates/:id', adminWriteProtection, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) {
        return res.status(400).json({ message: 'Invalid update ID' });
      }
      
      const updateData = updateOnlineUpdateSchema.parse({ id, ...req.body });
      const update = await storage.updateOnlineUpdate(id, updateData);
      
      if (!update) {
        return res.status(404).json({ message: 'Update not found' });
      }
      
      res.json({
        success: true,
        update
      });
    } catch (error: any) {
      res.status(400).json({ message: error.message });
    }
  });

  app.delete('/api/admin/online-updates/:id', adminWriteProtection, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) {
        return res.status(400).json({ message: 'Invalid update ID' });
      }
      
      const deleted = await storage.deleteOnlineUpdate(id);
      if (!deleted) {
        return res.status(404).json({ message: 'Update not found' });
      }
      
      res.json({
        success: true,
        message: 'Update deleted successfully'
      });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // Public API for apps to fetch active updates
  app.get('/api/updates', async (req, res) => {
    try {
      const updates = await storage.getActiveOnlineUpdates();
      res.json(updates);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // Reseller routes
  app.get('/api/reseller/profile', isReseller, async (req, res) => {
    try {
      const user = req.user as any;
      const reseller = await storage.getReseller(user.id);
      if (!reseller) {
        return res.status(404).json({ message: 'Reseller not found' });
      }
      
      const keys = await storage.getKeysByResellerId(reseller.id);
      const now = new Date();
      const activeKeys = keys.filter(key => !key.isRevoked && new Date(key.expiryDate) > now).length;
      const expiredKeys = keys.filter(key => !key.isRevoked && new Date(key.expiryDate) <= now).length;
      
      res.json({
        id: reseller.id,
        username: reseller.username,
        credits: reseller.credits,
        registrationDate: reseller.registrationDate,
        activeKeys,
        expiredKeys,
        totalKeys: keys.length
      });
    } catch (error) {
      res.status(500).json({ message: error.message });
    }
  });

  app.get('/api/reseller/keys', isReseller, async (req, res) => {
    try {
      const user = req.user as any;
      const keys = await storage.getKeysByResellerId(user.id);
      
      // Get device count for each key
      const keysWithDevices = await Promise.all(
        keys.map(async (key) => {
          const devices = await storage.getDevicesByKeyId(key.id);
          const now = new Date();
          let status = key.isRevoked ? "REVOKED" : 
                      (new Date(key.expiryDate) <= now ? "EXPIRED" : "ACTIVE");
          
          return {
            ...key,
            devices: devices.length,
            status
          };
        })
      );
      
      res.json(keysWithDevices);
    } catch (error) {
      res.status(500).json({ message: error.message });
    }
  });

  app.post('/api/reseller/keys/generate', isReseller, async (req, res) => {
    try {
      const user = req.user as any;
      
      // Log request data for debugging
      console.log("Incoming key generation request:", req.body);
      
      // Handle days parameter if provided instead of expiryDate
      let formData = { ...req.body };
      
      // If days parameter is provided, calculate expiryDate based on days
      if (req.body.days && !req.body.expiryDate) {
        const days = parseInt(req.body.days);
        const expiryDate = new Date();
        expiryDate.setDate(expiryDate.getDate() + days);
        formData.expiryDate = expiryDate;
        console.log(`Calculated expiry date from ${days} days:`, expiryDate);
      } else if (req.body.expiryDate) {
        // Parse expiryDate string to Date if it's a string
        formData.expiryDate = req.body.expiryDate instanceof Date 
          ? req.body.expiryDate 
          : new Date(req.body.expiryDate);
      }
      
      // Validate data with schema
      const keyData = insertKeySchema.parse(formData);
      
      // Log parsed data
      console.log("Parsed key data:", keyData);
      
      // Validate game enum
      try {
        gameEnum.parse(keyData.game);
      } catch (error) {
        return res.status(400).json({ message: 'Invalid game selection' });
      }
      
      // Check if custom key already exists
      if (keyData.keyString) {
        const existingKey = await storage.getKey(keyData.keyString);
        if (existingKey) {
          return res.status(400).json({ message: 'This key already exists' });
        }
      }
      
      // Check reseller credits
      const reseller = await storage.getReseller(user.id);
      if (!reseller) {
        return res.status(404).json({ message: 'Reseller not found' });
      }
      
      const count = req.body.count || 1;
      if (reseller.credits < count) {
        return res.status(400).json({ message: 'Insufficient credits' });
      }
      
      // Generate keys
      const generatedKeys = [];
      for (let i = 0; i < count; i++) {
        const keyString = keyData.keyString || generateKeyString(keyData.game);
        const key = await storage.createKey({
          ...keyData,
          keyString: i === 0 ? keyString : generateKeyString(keyData.game),
          resellerId: user.id
        });
        generatedKeys.push(key);
      }
      
      // Deduct credits
      await storage.updateResellerCredits(user.id, -count);
      
      // Also save keys to the reseller's JSON file using our utility
      try {
        // Format keys for storing in the JSON file
        const formattedKeys = generatedKeys.map(key => ({
          ...key,
          createdAt: key.createdAt instanceof Date ? key.createdAt.toISOString() : key.createdAt,
          expiryDate: key.expiryDate instanceof Date ? key.expiryDate.toISOString() : key.expiryDate
        }));
        
        // Use the utility to update the reseller's file
        db.updateResellerFile(reseller, formattedKeys);
        
        console.log(`Added ${generatedKeys.length} key(s) to ${reseller.username}'s file using the DB utility`);
      } catch (fileError) {
        console.error(`Error updating reseller key file: ${fileError.message}`);
        // Continue even if file update fails
      }
      
      res.status(201).json({
        success: true,
        keys: generatedKeys,
        remainingCredits: reseller.credits - count
      });
    } catch (error) {
      res.status(400).json({ message: error.message });
    }
  });

  app.post('/api/reseller/keys/:id/revoke', isReseller, async (req, res) => {
    try {
      const keyId = parseInt(req.params.id);
      const user = req.user as any;
      
      // Find the key
      const keys = await storage.getKeysByResellerId(user.id);
      const key = keys.find(k => k.id === keyId);
      
      if (!key) {
        return res.status(404).json({ message: 'Key not found or does not belong to you' });
      }
      
      // Revoke the key
      const revokedKey = await storage.revokeKey(keyId);
      
      res.json({
        success: true,
        key: revokedKey
      });
    } catch (error) {
      res.status(500).json({ message: error.message });
    }
  });

  app.get('/api/reseller/keys/:id', isReseller, async (req, res) => {
    try {
      const keyId = parseInt(req.params.id);
      const user = req.user as any;
      
      // Find the key
      const keys = await storage.getKeysByResellerId(user.id);
      const key = keys.find(k => k.id === keyId);
      
      if (!key) {
        return res.status(404).json({ message: 'Key not found or does not belong to you' });
      }
      
      // Get devices associated with the key
      const devices = await storage.getDevicesByKeyId(keyId);
      
      // Calculate status
      const now = new Date();
      let status = key.isRevoked ? "REVOKED" : 
                  (new Date(key.expiryDate) <= now ? "EXPIRED" : "ACTIVE");
      
      res.json({
        ...key,
        devices,
        status
      });
    } catch (error) {
      res.status(500).json({ message: error.message });
    }
  });

  app.post('/api/reseller/keys/:id/devices/:deviceId/remove', isReseller, async (req, res) => {
    try {
      const keyId = parseInt(req.params.id);
      const deviceId = req.params.deviceId;
      const user = req.user as any;
      
      // Find the key
      const keys = await storage.getKeysByResellerId(user.id);
      const key = keys.find(k => k.id === keyId);
      
      if (!key) {
        return res.status(404).json({ message: 'Key not found or does not belong to you' });
      }
      
      // Remove the device
      const success = await storage.removeDevice(deviceId, keyId);
      
      if (!success) {
        return res.status(404).json({ message: 'Device not found' });
      }
      
      res.json({
        success: true,
        message: 'Device removed successfully'
      });
    } catch (error) {
      res.status(500).json({ message: error.message });
    }
  });

  // Public API for key verification
  app.post('/api/verify', async (req, res) => {
    try {
      const { key: keyString, deviceId, game } = keyVerificationSchema.parse(req.body);
      
      // Find the key
      const key = await storage.getKey(keyString);
      
      // Key not found
      if (!key) {
        return res.json({
          valid: false,
          message: "Invalid license key"
        });
      }
      
      // Check if key is for the right game
      if (key.game !== game) {
        return res.json({
          valid: false,
          message: "License key is not valid for this game"
        });
      }
      
      // Check if key is revoked
      if (key.isRevoked) {
        return res.json({
          valid: false,
          message: "License key has been revoked"
        });
      }
      
      // Check if key is expired
      const now = new Date();
      if (new Date(key.expiryDate) <= now) {
        return res.json({
          valid: false,
          message: "License key has expired",
          expiry: key.expiryDate
        });
      }
      
      // Get devices for this key
      const devices = await storage.getDevicesByKeyId(key.id);
      
      // Check if device is already registered
      const deviceExists = devices.some(d => d.deviceId === deviceId);
      
      // If device exists, return success
      if (deviceExists) {
        return res.json({
          valid: true,
          expiry: key.expiryDate,
          deviceLimit: key.deviceLimit,
          currentDevices: devices.length,
          message: "License valid"
        });
      }
      
      // Check device limit
      if (devices.length >= key.deviceLimit) {
        return res.json({
          valid: false,
          expiry: key.expiryDate,
          deviceLimit: key.deviceLimit,
          currentDevices: devices.length,
          message: "Device limit reached for this license key"
        });
      }
      
      // Register new device
      await storage.addDevice({
        keyId: key.id,
        deviceId
      });
      
      // Return success
      return res.json({
        valid: true,
        expiry: key.expiryDate,
        deviceLimit: key.deviceLimit,
        currentDevices: devices.length + 1,
        message: "License valid"
      });
    } catch (error) {
      res.status(400).json({ 
        valid: false,
        message: error.message 
      });
    }
  });

  // GET API for key verification
  app.get('/api/verify/:key/:game/:deviceId', async (req, res) => {
    try {
      const keyString = req.params.key;
      const game = req.params.game;
      const deviceId = req.params.deviceId;
      
      // Validate params
      if (!keyString || !game || !deviceId) {
        return res.status(400).json({ 
          valid: false,
          message: "Missing required parameters. Need key, game, and deviceId." 
        });
      }

      // Validate game
      if (!["PUBG MOBILE", "LAST ISLAND OF SURVIVAL", "STANDOFF2"].includes(game)) {
        return res.status(400).json({ 
          valid: false,
          message: "Invalid game. Must be one of: PUBG MOBILE, LAST ISLAND OF SURVIVAL, STANDOFF2" 
        });
      }
      
      // Find the key
      const key = await storage.getKey(keyString);
      
      // Key not found
      if (!key) {
        return res.json({
          valid: false,
          message: "Invalid license key"
        });
      }
      
      // Check if key is for the right game
      if (key.game !== game) {
        return res.json({
          valid: false,
          message: "License key is not valid for this game"
        });
      }
      
      // Check if key is revoked
      if (key.isRevoked) {
        return res.json({
          valid: false,
          message: "License key has been revoked"
        });
      }
      
      // Check if key is expired
      const now = new Date();
      if (new Date(key.expiryDate) <= now) {
        return res.json({
          valid: false,
          message: "License key has expired",
          expiry: key.expiryDate
        });
      }
      
      // Get devices for this key
      const devices = await storage.getDevicesByKeyId(key.id);
      
      // Check if device is already registered
      const deviceExists = devices.some(d => d.deviceId === deviceId);
      
      // If device exists, return success
      if (deviceExists) {
        return res.json({
          valid: true,
          expiry: key.expiryDate,
          deviceLimit: key.deviceLimit,
          currentDevices: devices.length,
          message: "License valid"
        });
      }
      
      // Check device limit
      if (devices.length >= key.deviceLimit) {
        return res.json({
          valid: false,
          expiry: key.expiryDate,
          deviceLimit: key.deviceLimit,
          currentDevices: devices.length,
          message: "Device limit reached for this license key"
        });
      }
      
      // Return success but do not register device (GET request is for checking only)
      return res.json({
        valid: true,
        expiry: key.expiryDate,
        deviceLimit: key.deviceLimit,
        currentDevices: devices.length,
        canRegister: true,
        message: "License valid, device can be registered"
      });
    } catch (error) {
      res.status(400).json({ 
        valid: false,
        message: "Error verifying license key" 
      });
    }
  });

  // Helper functions
  function generateKeyString(game: string): string {
    let prefix = "";
    
    if (game === "PUBG MOBILE") {
      prefix = "PBGM";
    } else if (game === "LAST ISLAND OF SURVIVAL") {
      prefix = "LIOS";
    } else if (game === "STANDOFF2") {
      prefix = "STDF";
    }
    
    const segments = [
      nanoid(5).toUpperCase(),
      nanoid(5).toUpperCase(),
      nanoid(5).toUpperCase()
    ];
    
    return `${prefix}-${segments.join('-')}`;
  }

  const httpServer = createServer(app);
  return httpServer;
}
