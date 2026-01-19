const express = require('express');
const puppeteer = require('puppeteer');

const app = express();
const PORT = process.env.PORT || 3000;

// Environment variables
const LOGISLY_EMAIL = process.env.LOGISLY_EMAIL;
const LOGISLY_PASSWORD = process.env.LOGISLY_PASSWORD;
const API_KEY = process.env.API_KEY || 'change-this-key';
const LOGISLY_LOGIN_URL = process.env.LOGISLY_LOGIN_URL || 'https://logisly.com/login';
const LOGISLY_ORDERS_URL = process.env.LOGISLY_ORDERS_URL || 'https://logisly.com/open-orders';

// API Key middleware
function requireApiKey(req, res, next) {
  const apiKey = req.headers['x-api-key'];
  
  if (!apiKey || apiKey !== API_KEY) {
    return res.status(401).json({
      success: false,
      error: 'Unauthorized',
      message: 'Invalid or missing API key'
    });
  }
  
  next();
}

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ 
    status: 'ok',
    service: 'Logisly Scraper',
    version: '1.0.0'
  });
});

// Main scrape endpoint
app.get('/scrape', requireApiKey, async (req, res) => {
  let browser;
  
  try {
    console.log('🚀 Starting scrape...');
    
    // Validate credentials
    if (!LOGISLY_EMAIL || !LOGISLY_PASSWORD) {
      throw new Error('Missing Logisly credentials in environment variables');
    }
    
    // Launch browser
    browser = await puppeteer.launch({
      headless: process.env.HEADLESS !== 'false',
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu'
      ]
    });
    
    const page = await browser.newPage();
    
    // Set viewport
    await page.setViewport({ width: 1920, height: 1080 });
    
    console.log('📝 Navigating to login page...');
    
    // Go to login page
    await page.goto(LOGISLY_LOGIN_URL, {
      waitUntil: 'networkidle2',
      timeout: 30000
    });
    
    console.log('🔐 Logging in...');
    
    // Fill email
    await page.waitForSelector('input[type="email"], input[name="email"]', { timeout: 10000 });
    await page.type('input[type="email"], input[name="email"]', LOGISLY_EMAIL);
    
    // Fill password
    await page.type('input[type="password"]', LOGISLY_PASSWORD);
    
    // Click login button - use XPath for text matching
    const loginButton = await page.$x("//button[contains(text(), 'Login') or contains(text(), 'Masuk') or @type='submit']");
    if (loginButton.length > 0) {
      await loginButton[0].click();
    } else {
      // Fallback: just click any submit button
      await page.click('button[type="submit"]');
    }
    
    // Wait for navigation
    await page.waitForNavigation({ 
      waitUntil: 'networkidle2',
      timeout: 15000
    });
    
    console.log('✅ Login successful');
    
    // Navigate to orders page
    console.log('📋 Loading orders page...');
    await page.goto(LOGISLY_ORDERS_URL, {
      waitUntil: 'networkidle2',
      timeout: 30000
    });
    
    // Wait for orders table
    await page.waitForSelector('table, .orders-list, [class*="order"]', { timeout: 10000 });
    
    // Try clicking Non-SPX tab if exists
    try {
      // Use XPath for text matching
      const nonSpxButton = await page.$x("//button[contains(text(), 'Non-SPX')] | //a[contains(text(), 'Non-SPX')]");
      if (nonSpxButton.length > 0) {
        console.log('📌 Clicking Non-SPX tab...');
        await nonSpxButton[0].click();
        await new Promise(resolve => setTimeout(resolve, 2000));
      }
    } catch (e) {
      console.log('ℹ️ Non-SPX tab not found or not needed');
    }
    
    // Extract orders
    console.log('📊 Extracting orders...');
    
    const orders = await page.evaluate(() => {
      const rows = Array.from(document.querySelectorAll('table tr, [class*="order-row"]'));
      const extractedOrders = [];
      let index = 0;
      
      rows.forEach(row => {
        const cells = Array.from(row.querySelectorAll('td'));
        
        if (cells.length >= 6) {
          const shipper = cells[0]?.innerText?.trim() || '';
          const datetime = cells[1]?.innerText?.trim() || '';
          const route = cells[2]?.innerText?.trim() || '';
          const truck = cells[3]?.innerText?.trim() || '';
          const priceText = cells[4]?.innerText?.trim() || '';
          const status = cells[5]?.innerText?.trim() || '';
          
          // Skip header rows
          if (shipper.toLowerCase().includes('shipper') || !shipper) return;
          
          // Parse price
          const price = parseInt(priceText.replace(/[^0-9]/g, '')) || 0;
          if (price === 0) return;
          
          // Parse route
          const [asal, tujuan] = route.split('-').map(s => s.trim());
          
          // Parse datetime
          const dateMatch = datetime.match(/(\d+)\s+(\w+)\s+(\d+:\d+)/);
          const hari = dateMatch ? dateMatch[1] : '';
          const bulan = dateMatch ? dateMatch[2] : '';
          const jam = dateMatch ? dateMatch[3] : '';
          
          // Estimate tonnage
          let tonase = 5;
          const truckLower = truck.toLowerCase();
          if (truckLower.includes('tronton')) tonase = 15;
          else if (truckLower.includes('wb') || truckLower.includes('wingbox')) tonase = 8;
          else if (truckLower.includes('cddl')) tonase = 5;
          else if (truckLower.includes('cde')) tonase = 3;
          
          extractedOrders.push({
            jobId: `LOGISLY-${Date.now()}-${index++}`,
            shipper: shipper,
            tanggal: `${hari} ${bulan} 2025`,
            jamMuat: jam,
            jam: jam,
            asal: asal || '',
            tujuan: tujuan || '',
            rute: route,
            tipeTruk: truck,
            jenisKendaraan: truck,
            hargaPenawaran: price,
            harga: price,
            tonase: tonase,
            status: status,
            contact: shipper,
            deadline: datetime,
            jenisBarang: 'General Cargo'
          });
        }
      });
      
      return extractedOrders;
    });
    
    await browser.close();
    
    console.log(`✅ Scraped ${orders.length} orders successfully`);
    
    res.json({
      success: true,
      orders: orders,
      totalOrders: orders.length,
      scrapedAt: new Date().toISOString()
    });
    
  } catch (error) {
    console.error('❌ Scraping error:', error);
    
    if (browser) {
      await browser.close();
    }
    
    res.status(500).json({
      success: false,
      error: error.message,
      details: error.stack
    });
  }
});

// Start server
app.listen(PORT, () => {
  console.log(`🚀 Logisly Scraper running on port ${PORT}`);
  console.log(`📍 Health check: http://localhost:${PORT}/health`);
  console.log(`📍 Scrape endpoint: http://localhost:${PORT}/scrape`);
  console.log(`🔐 API Key required: X-API-Key header`);
});
