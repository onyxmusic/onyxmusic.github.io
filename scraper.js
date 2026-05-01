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
  console.log("🚀 OnyxMusic Ultra-Scraper Başlıyor...");
  
  const browser = await puppeteer.launch({ 
    headless: true,
    args:['--no-sandbox', '--disable-setuid-sandbox'] 
  });

  const fullFeed = {};

  for (const [langCode, config] of Object.entries(REGIONS)) {
    const url = 'https://www.youtube.com/feed/music'; // HATA DÜZELTİLDİ: Burada eksik tırnaklar vardı
    console.log(`\n⏳ İşleniyor: [${langCode.toUpperCase()}]`);
    
    const page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

    await page.setCookie({ name: 'PREF', value: `hl=${config.hl}&gl=${config.gl}`, domain: '.youtube.com', path: '/' });
    await page.setCookie({ name: 'SOCS', value: 'CAESEwgDEgk0ODE3Nzk3MjQaAmVuIAEaBgiA_LyaBg', domain: '.youtube.com', path: '/' });

    try {
      await page.goto(url, { waitUntil: 'networkidle2', timeout: 60000 });
      await delay(3000); 
      
      // Sayfayı kaydırarak resimlerin "doğmasını" sağlıyoruz
      await page.evaluate(() => window.scrollBy(0, 5000));
      await delay(3000); 

      const sectionData = await page.evaluate(() => {
        const sections = [];
        const shelves = document.querySelectorAll('ytd-rich-section-renderer, ytd-shelf-renderer');
        
        shelves.forEach(shelf => {
          const title = shelf.querySelector('#title, #title-text, yt-formatted-string')?.textContent?.trim();
          if (!title) return;

          const items = [];
          const cards = shelf.querySelectorAll('ytd-rich-item-renderer, ytd-grid-playlist-renderer, ytd-compact-playlist-renderer');
          
          cards.forEach(card => {
            const link = card.querySelector('a[href*="list=RDCLAK"], a[href*="list=PL"]');
            if (!link) return;
            const id = link.href.match(/list=([^&]+)/)?.[1];
            
            // 👑 ORİJİNAL KAPAK ÇEKİCİ
            const imgEl = card.querySelector('img');
            let img = "";
            if (imgEl) {
                // srcset içinde en yüksek çözünürlüğü ara
                img = imgEl.srcset ? imgEl.srcset.split(',').pop().trim().split(' ')[0] : imgEl.src;
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
      console.log(`   ✅ ${sectionData.length} kategori başarıyla yakalandı.`);
    } catch (e) {
      console.error(`   ❌ Hata [${langCode}]: ${e.message}`);
    }
    await page.close();
  }

  await browser.close();
  fs.writeFileSync('feed.json', JSON.stringify(fullFeed, null, 2), 'utf-8');
  console.log("\n🎉 İşlem Tamamlandı! Tüm resimler orijinal halleriyle kaydedildi.");
})();
