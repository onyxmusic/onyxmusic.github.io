const puppeteer = require('puppeteer');
const fs = require('fs');

// Bütün diller ve ülkeler
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
  console.log("🚀 OnyxMusic Otomatik Scraper Başlıyor (Orijinal Kapak Modu)...");
  
  const browser = await puppeteer.launch({ 
    headless: true,
    args:['--no-sandbox', '--disable-setuid-sandbox'] 
  });

  const fullFeed = {};

  for (const [langCode, config] of Object.entries(REGIONS)) {
    const url = `https://www.youtube.com/feed/music`;
    console.log(`\n⏳ İşleniyor: [${langCode.toUpperCase()}] (Dil: ${config.hl}, Ülke: ${config.gl})`);
    
    const page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/114.0.0.0 Safari/537.36');

    // 1. YouTube'u Kandıran Çerez (Dil ve Ülke Ayarı)
    await page.setCookie({
      name: 'PREF',
      value: `hl=${config.hl}&gl=${config.gl}`,
      domain: '.youtube.com',
      path: '/'
    });

    // 2. Çerez Onay Ekranını Atlamak İçin
    await page.setCookie({
      name: 'SOCS',
      value: 'CAESEwgDEgk0ODE3Nzk3MjQaAmVuIAEaBgiA_LyaBg',
      domain: '.youtube.com',
      path: '/'
    });

    try {
      await page.goto(url, { waitUntil: 'networkidle2', timeout: 60000 });
      await delay(2000); 
      
      console.log(`   Sayfa aşağı kaydırılıyor (Kapakların yüklenmesi için)...`);
      await page.evaluate(async () => {
        await new Promise((resolve) => {
          let totalHeight = 0;
          let distance = 300;
          let timer = setInterval(() => {
            let scrollHeight = document.body.scrollHeight;
            window.scrollBy(0, distance);
            totalHeight += distance;
            // Tüm resimlerin yüklenmesi için bol bol aşağı kaydırıyoruz
            if (totalHeight >= scrollHeight || totalHeight > 8000) { 
              clearInterval(timer); resolve(); 
            }
          }, 300);
        });
      });

      // 👑 SİHİR BURADA: Artık arka plana girmiyoruz, doğrudan ekrandaki orijinal resmi alıyoruz!
      const sectionData = await page.evaluate(() => {
        const sections =[];
        const elements = document.querySelectorAll('ytd-rich-section-renderer, ytd-shelf-renderer');
        
        for (let section of elements) {
          const sectionTitle = section.querySelector('#title, #title-text, yt-formatted-string')?.textContent?.trim();
          if (!sectionTitle) continue;

          const items =[];
          const seenIds = new Set();
          const cards = section.querySelectorAll('ytd-rich-item-renderer, ytd-grid-playlist-renderer, ytd-compact-playlist-renderer');
          
          for (let card of cards) {
            const linkEl = card.querySelector('a[href*="list=RDCLAK"], a[href*="list=PL"]');
            if (!linkEl) continue;
            
            const match = linkEl.href.match(/list=((?:RDCLAK|PL)[^&]+)/);
            if (!match) continue;
            
            const id = match[1];
            if (seenIds.has(id)) continue;

            let name = card.querySelector('#video-title')?.textContent?.trim() || card.querySelector('h3')?.textContent?.trim();
            if (!name) {
              card.querySelectorAll('a[href*="list=RDCLAK"], a[href*="list=PL"]').forEach(a => {
                const text = a.querySelector('span, yt-formatted-string')?.textContent?.trim() || a.textContent?.trim() || a.title;
                if (text && !text.match(/\d+\s*(şarkı|video|songs|videos|canciones)/i)) name = text;
              });
            }

            // 👑 ORİJİNAL KAPAK RESMİNİ YAKALAMA
            let img = "";
            const imgEl = card.querySelector('img');
            if (imgEl) {
              img = imgEl.src || "";
              // Bazen YouTube resim yüklenene kadar sahte bir base64 resim koyar, böyle bir durum varsa data-thumb'ı alıyoruz
              if (img.startsWith('data:image') || img.includes('pixel_')) {
                img = imgEl.getAttribute('data-thumb') || img;
              }
            }

            items.push({ id, name: name || "İsimsiz", img });
            seenIds.add(id);
          }
          if (items.length > 0) sections.push({ section_title: sectionTitle, items });
        }
        return sections;
      });

      fullFeed[langCode] = sectionData;
      console.log(`   ✅ ${sectionData.length} kategori ve orijinal kapaklar başarıyla çekildi!`);

    } catch (error) {
      console.error(`   ❌ Hata oluştu[${langCode}]:`, error.message);
    } finally {
      await page.close();
    }
  }

  await browser.close();

  fs.writeFileSync('feed.json', JSON.stringify(fullFeed, null, 2), 'utf-8');
  console.log("\n🎉 İşlem Tamamlandı! Tüm diller ve orijinal kapaklar feed.json dosyasına ışık hızında kaydedildi.");
})();
