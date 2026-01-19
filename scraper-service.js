// ============================================
// LOGISLY SCRAPER WEB SERVICE
// ============================================
// Express.js API for n8n Cloud to call

const express = require('express');
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
puppeteer.use(StealthPlugin());

const app = express();
app.use(express.json());

// ============================================
// CONFIGURATION
// ============================================

const CONFIG = {
  email: process.env.LOGISLY_EMAIL,
  password: process.env.LOGISLY_PASSWORD,
  loginUrl: process.env.LOGISLY_LOGIN_URL || 'https://logisly.com/login',
  openOrdersUrl: process.env.LOGISLY_ORDERS_URL || 'https://logisly.com/open-orders',
  apiKey: process.env.API_KEY || 'change-this-secret-key',
  port: process.env.PORT || 3000,
  headless: process.env.HEADLESS !== 'false',
  timeout: parseInt(process.env.TIMEOUT) || 60000,
};

// ============================================
// AUTHENTICATION MIDDLEWARE
// ============================================

function authenticate(req, res, next) {
  const apiKey = req.headers['x-api-key'] || req.query.apiKey;
  
  if (!apiKey || apiKey !== CONFIG.apiKey) {
    return res.status(401).json({
      success: false,
      error: 'Unauthorized',
      message: 'Invalid or missing API key'
    });
  }
  
  next();
}

// ============================================
// SCRAPER FUNCTION
// ============================================

async function scrapeLogislyOrders() {
  console.log('🚀 Starting Logisly scraper...');
  
  let browser;
  
  try {
    // Launch browser
    browser = await puppeteer.launch({
      headless: CONFIG.headless,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-web-security',
        '--disable-features=IsolateOrigins,site-per-process'
      ]
    });
    
    const page = await browser.newPage();
    await page.setViewport({ width: 1920, height: 1080 });
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36');
    
    // ============================================
    // LOGIN
    // ============================================
    
    console.log('🔐 Logging in...');
    await page.goto(CONFIG.loginUrl, { waitUntil: 'networkidle2', timeout: CONFIG.timeout });
    
    // Wait for and fill login form
    await page.waitForSelector('input[type="email"], input[name="email"]', { timeout: 10000 });
    await page.type('input[type="email"], input[name="email"]', CONFIG.email);
    await page.type('input[type="password"], input[name="password"]', CONFIG.password);
    
    // Click login and wait for navigation
    await Promise.all([
      page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 30000 }),
      page.click('button[type="submit"], input[type="submit"], .btn-login')
    ]);
    
    console.log('✅ Login successful');
    
    // ============================================
    // NAVIGATE TO OPEN ORDERS
    // ============================================
    
    console.log('📋 Navigating to Open Orders...');
    await page.goto(CONFIG.openOrdersUrl, { waitUntil: 'networkidle2', timeout: CONFIG.timeout });
    await page.waitForSelector('table', { timeout: 20000 });
    
    // ============================================
    // SCRAPE DATA
    // ============================================
    
    console.log('🔍 Scraping orders...');
    
    const orders = await page.evaluate(() => {
      const rows = Array.from(document.querySelectorAll('table tbody tr'));
      
      return rows.map((row, index) => {
        const cells = row.querySelectorAll('td');
        if (cells.length < 6) return null;
        
        const shipper = cells[0]?.textContent?.trim() || '';
        const tanggal = cells[1]?.textContent?.trim() || '';
        const rute = cells[2]?.textContent?.trim() || '';
        const tipeTruk = cells[3]?.textContent?.trim() || '';
        const hargaText = cells[4]?.textContent?.trim() || '';
        const status = cells[5]?.textContent?.trim() || '';
        
        const harga = parseFloat(hargaText.replace(/[^0-9]/g, '')) || 0;
        const [asal, tujuan] = rute.split('-').map(s => s?.trim());
        
        const tanggalMatch = tanggal.match(/(\d+)\s+(\w+)\s+(\d+:\d+)/);
        const hari = tanggalMatch ? tanggalMatch[1] : '';
        const bulan = tanggalMatch ? tanggalMatch[2] : '';
        const jam = tanggalMatch ? tanggalMatch[3] : '';
        
        // Determine tonase based on truck type
        let tonase = 5;
        if (tipeTruk.includes('Tronton')) tonase = 15;
        else if (tipeTruk.includes('WB') || tipeTruk.includes('Wingbox')) tonase = 8;
        else if (tipeTruk.includes('CDDL')) tonase = 5;
        else if (tipeTruk.includes('CDE')) tonase = 3;
        
        return {
          jobId: `LOGISLY-${Date.now()}-${index}`,
          shipper,
          tanggal: `${hari} ${bulan} 2025`,
          jamMuat: jam,
          asal: asal || '',
          tujuan: tujuan || '',
          rute,
          tipeTruk,
          jenisKendaraan: tipeTruk,
          hargaPenawaran: harga,
          tonase,
          status,
          contact: shipper,
          deadline: tanggal,
          jenisBarang: 'General Cargo',
          keterangan: status,
          source: 'Logisly Open Orders',
          timestamp: new Date().toISOString()
        };
      }).filter(order => order !== null && order.hargaPenawaran > 0);
    });
    
    console.log(`✅ Scraped ${orders.length} orders`);
    
    return {
      success: true,
      orders,
      scrapedAt: new Date().toISOString(),
      totalOrders: orders.length,
      source: 'Logisly Open Orders'
    };
    
  } catch (error) {
    console.error('❌ Scraping error:', error);
    return {
      success: false,
      error: error.message,
      orders: [],
      scrapedAt: new Date().toISOString()
    };
  } finally {
    if (browser) {
      await browser.close();
    }
  }
}

// ============================================
// API ENDPOINTS
// ============================================

// Health check
app.get('/', (req, res) => {
  res.json({
    service: 'Logisly Scraper API',
    status: 'running',
    version: '1.0.0',
    endpoints: {
      health: 'GET /',
      scrape: 'GET /scrape (requires X-API-Key header)'
    }
  });
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    uptime: process.uptime()
  });
});

// Scrape endpoint (protected)
app.get('/scrape', authenticate, async (req, res) => {
  console.log('📞 Received scrape request');
  
  // Check if credentials are configured
  if (!CONFIG.email || !CONFIG.password) {
    return res.status(500).json({
      success: false,
      error: 'Configuration error',
      message: 'LOGISLY_EMAIL and LOGISLY_PASSWORD must be set'
    });
  }
  
  try {
    const result = await scrapeLogislyOrders();
    res.json(result);
  } catch (error) {
    console.error('💥 Request error:', error);
    res.status(500).json({
      success: false,
      error: error.message,
      orders: []
    });
  }
});

// ============================================
// START SERVER
// ============================================

app.listen(CONFIG.port, () => {
  console.log('🚀 Logisly Scraper API started');
  console.log(`📍 Port: ${CONFIG.port}`);
  console.log(`🔐 Authentication: ${CONFIG.apiKey ? 'Enabled' : 'Disabled'}`);
  console.log(`👤 Logisly Email: ${CONFIG.email ? CONFIG.email : 'NOT SET'}`);
  console.log(`🌐 Endpoints:`);
  console.log(`   GET  /           - Service info`);
  console.log(`   GET  /health     - Health check`);
  console.log(`   GET  /scrape     - Scrape orders (auth required)`);
  console.log('');
  console.log('✅ Ready to accept requests!');
});

// Handle graceful shutdown
process.on('SIGTERM', () => {
  console.log('👋 SIGTERM received, shutting down gracefully...');
  process.exit(0);
});

process.on('SIGINT', () => {
  console.log('👋 SIGINT received, shutting down gracefully...');
  process.exit(0);
});
