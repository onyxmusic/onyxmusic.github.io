const puppeteer = require('puppeteer');
const fs = require('fs');

const REGIONS = {
  "tr": { gl: "TR", hl: "tr" },
  "en": { gl: "US", hl: "en" },
  "fr": { gl: "FR", hl: "fr" },
  "de": { gl: "DE", hl: "de" },
  "es": { gl: "ES", hl: "es" },
  "it": { gl: "IT", hl: "it" },
  "pt": { gl: "BR", hl: "pt" },
  "ru": { gl: "RU", hl: "ru" },
  "ar": { gl: "AE", hl: "ar" },
  "ja": { gl: "JP", hl: "ja" },
  "hi": { gl: "IN", hl: "hi" },
  "zh": { gl: "TW", hl: "zh-TW" }
};

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

(async () => {
  console.log("🚀 OnyxMusic Ultra-Scraper Başlıyor (RAM Korumalı)...");
  
  // 👑 GITHUB SUNUCULARININ ÇÖKMESİNİ ENGELLEYEN AYARLAR
  const browser = await puppeteer.launch({ 
    headless: true,
    args:[
      '--no-sandbox', 
      '--disable-setuid-sandbox', 
      '--disable-dev-shm-usage', // Hafıza şişmesini engeller
      '--disable-gpu',           // Ekran kartı yükünü kapatır
      '--disable-blink-features=AutomationControlled'
    ] 
  });

  const fullFeed = {};

  for (const [langCode, config] of Object.entries(REGIONS)) {
    const url = 'https://www.youtube.com/feed/music';
    console.log(`\n⏳ İşleniyor: [${langCode.toUpperCase()}]`);
    
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 1080 });
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

    await page.setCookie({ name: 'PREF', value: `hl=${config.hl}&gl=${config.gl}`, domain: '.youtube.com', path: '/' });
    await page.setCookie({ name: 'SOCS', value: 'CAESEwgDEgk0ODE3Nzk3MjQaAmVuIAEaBgiA_LyaBg', domain: '.youtube.com', path: '/' });

    try {
      await page.goto(url, { waitUntil: 'networkidle2', timeout: 60000 });
      
      // TÜM PLAYLİSTLERİ YÜKLEME DÖNGÜSÜ
      await page.evaluate(async () => {
        await new Promise((resolve) => {
          let totalHeight = 0;
          let distance = 600; 
          let timer = setInterval(() => {
            let scrollHeight = document.body.scrollHeight;
            window.scrollBy(0, distance);
            totalHeight += distance;
            
            if (totalHeight >= scrollHeight || totalHeight > 15000) { 
              clearInterval(timer);
              resolve(); 
            }
          }, 800); 
        });
      });

      await delay(3000); 

      const sectionData = await page.evaluate(() => {
        const sections =[];
        const shelves = document.querySelectorAll('ytd-rich-section-renderer, ytd-shelf-renderer');
        
        shelves.forEach(shelf => {
          const title = shelf.querySelector('#title, #title-text, yt-formatted-string')?.textContent?.trim();
          if (!title) return;

          const items =[];
          const cards = shelf.querySelectorAll('ytd-rich-item-renderer, ytd-grid-playlist-renderer, ytd-compact-playlist-renderer');
          
          cards.forEach(card => {
            const link = card.querySelector('a[href*="list=RDCLAK"], a[href*="list=PL"]');
            if (!link) return;
            const id = link.href.match(/list=([^&]+)/)?.[1];
            
            const imgEl = card.querySelector('img');
            let img = "";
            if (imgEl) {
                let src = imgEl.src || "";
                let srcset = imgEl.srcset ? imgEl.srcset.split(',').pop().trim().split(' ')[0] : "";
                let thumb = imgEl.getAttribute('data-thumb') || "";
                img = srcset || thumb || src;
            }

            if (id && img && !img.includes('pixel')) {
                items.push({ id, name: card.querySelector('#video-title, h3')?.textContent?.trim() || "İsimsiz", img });
            }
          });
          if (items.length > 0) sections.push({ section_title: title, items });
        });
        return sections;
      });

      fullFeed[langCode] = sectionData;
      console.log(`   ✅ ${sectionData.length} kategori ve kapaklar çekildi.`);
    } catch (e) {
      console.error(`   ❌ Hata [${langCode}]: ${e.message}`);
    }
    await page.close(); // İşlem biten sekmeyi kapat ki RAM dolsun
  }

  await browser.close();

  try {
      const pkgInfo = JSON.parse(fs.readFileSync('package.json', 'utf8'));
      pkgInfo.lastUpdated = new Date().toISOString();
      fs.writeFileSync('package.json', JSON.stringify(pkgInfo, null, 2), 'utf-8');
  } catch (e) {}

  fs.writeFileSync('feed.json', JSON.stringify(fullFeed, null, 2), 'utf-8');
  console.log("🎉 İşlem Tamamlandı!");
})();
