const express = require('express');
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');

// Use stealth to prevent being blocked by Cloudflare/distil
puppeteer.use(StealthPlugin());

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;

app.post('/scrape', async (req, res) => {
    const { url } = req.body;

    if (!url) {
        return res.status(400).json({ success: false, error: "URL is required" });
    }

    let browser;
    try {
        // 1. Launch with optimized flags for Railway/Docker
        browser = await puppeteer.launch({
            headless: "new",
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage', // Prevents crashes in low-memory environments
                '--disable-accelerated-2d-canvas',
                '--no-first-run',
                '--no-zygote',
                '--disable-gpu'
            ]
        });

        const page = await browser.newPage();

        // 2. Set a realistic User-Agent
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

        // 3. Optimized Navigation
        // We increase timeout to 60s and use 'networkidle2' (wait until only 2 active connections)
        console.log(`Navigating to: ${url}`);
        await page.goto(url, {
            waitUntil: 'networkidle2',
            timeout: 60000 
        });

        // 4. Extract Data (Example: Title and Page Content)
        const data = await page.evaluate(() => {
            return {
                title: document.title,
                html: document.body.innerText.substring(0, 1000), // First 1000 chars
            };
        });

        res.json({ success: true, data });

    } catch (error) {
        console.error("Scraping Error:", error.message);
        res.status(500).json({
            success: false,
            error: error.message,
            details: "Timeout likely caused by slow target site or anti-bot challenge."
        });
    } finally {
        // 5. CRITICAL: Always close the browser to prevent Railway memory leaks
        if (browser) {
            await browser.close();
        }
    }
});

app.listen(PORT, () => {
    console.log(`Scraper service listening on port ${PORT}`);
});
