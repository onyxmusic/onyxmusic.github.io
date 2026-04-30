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
  console.log("🚀 OnyxMusic Ultra-Scraper Başlıyor (Resim Kaçırmayan Mod)...");
  
  const browser = await puppeteer.launch({ 
    headless: true,
    args:['--no-sandbox', '--disable-setuid-sandbox'] 
  });

  const fullFeed = {};

  for (const [langCode, config] of Object.entries(REGIONS)) {
    const url = `https://www.youtube.com/feed/music`;
    console.log(`\n⏳ [${langCode.toUpperCase()}] İşleniyor...`);
    
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 1080 }); // Geniş ekran yapalım ki daha çok kart sığsın
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/116.0.0.0 Safari/537.36');

    // 1. YouTube Dil/Ülke Ayarı
    await page.setCookie({ name: 'PREF', value: `hl=${config.hl}&gl=${config.gl}`, domain: '.youtube.com', path: '/' });
    await page.setCookie({ name: 'SOCS', value: 'CAESEwgDEgk0ODE3Nzk3MjQaAmVuIAEaBgiA_LyaBg', domain: '.youtube.com', path: '/' });

    try {
      await page.goto(url, { waitUntil: 'networkidle2', timeout: 60000 });
      
      console.log(`   🎨 Resimlerin yüklenmesi için akıllı kaydırma yapılıyor...`);
      
      // 👑 AKILLI KAYDIRMA MOTORU: Her 800 pikselde bir durup 0.5 saniye resim bekler
      await page.evaluate(async () => {
        await new Promise((resolve) => {
          let totalHeight = 0;
          let distance = 800; 
          let timer = setInterval(() => {
            window.scrollBy(0, distance);
            totalHeight += distance;
            if (totalHeight >= 7000) { // Sayfanın yeterince derinliğine in (Ayarlanabilir)
              clearInterval(timer);
              resolve();
            }
          }, 500); // Her kaydırmada yarım saniye bekle
        });
      });

      await delay(2000); // En son bir 2 saniye daha bekle her şey tam otursun

      // 👑 GELİŞMİŞ VERİ TOPLAYICI
      const sectionData = await page.evaluate(() => {
        const sections = [];
        const shelves = document.querySelectorAll('ytd-rich-section-renderer, ytd-shelf-renderer');
        
        for (let shelf of shelves) {
          const sectionTitle = shelf.querySelector('#title, #title-text, yt-formatted-string')?.textContent?.trim();
          if (!sectionTitle) continue;

          const items = [];
          const seenIds = new Set();
          const cards = shelf.querySelectorAll('ytd-rich-item-renderer, ytd-grid-playlist-renderer, ytd-compact-playlist-renderer');
          
          for (let card of cards) {
            const linkEl = card.querySelector('a[href*="list=RDCLAK"], a[href*="list=PL"]');
            if (!linkEl) continue;
            
            const match = linkEl.href.match(/list=([^&]+)/);
            if (!match) continue;
            const id = match[1];
            if (seenIds.has(id)) continue;

            // Başlık Çekme
            let name = card.querySelector('#video-title, h3, #title')?.textContent?.trim();
            if (!name) {
              const altText = card.querySelector('yt-formatted-string[title]')?.getAttribute('title');
              name = altText || "İsimsiz";
            }

            // 👑 AGRESİF RESİM ÇEKME (Hepsini yakalar)
            let img = "";
            const imgEl = card.querySelector('img');
            if (imgEl) {
              // Eğer yüklenmediyse bile data-thumb veya thumbnails linkini kovala
              img = imgEl.src;
              let thumb = imgEl.getAttribute('data-thumb');
              let srcset = imgEl.srcset ? imgEl.srcset.split(',').pop().trim().split(' ')[0] : null;
              
              let finalImg = srcset || thumb || img;
              
              // Sahte pikselleri temizle
              if (finalImg.includes('data:image') || finalImg.includes('pixel_')) {
                  finalImg = ""; 
              }
              img = finalImg;
            }

            // Eğer resim hala boşsa, playlist ID'den zorla çekmeye çalışalım (B planı)
            if (!img && id.startsWith('RDCLAK')) {
                img = `https://i.ytimg.com/vi_webp/search/hqdefault.jpg`; // En azından boş kalmasın
            }

            if (img) { // Sadece resmi olanları ekle ki uygulama çirkin durmasın
              items.push({ id, name, img });
              seenIds.add(id);
            }
          }
          if (items.length > 0) sections.push({ section_title: sectionTitle, items });
        }
        return sections; sectionTitle, items });
      });

      fullFeed[langCode] = sectionData;
      console.log(`   ✅ [${langCode.toUpperCase()}] Tamamlandı: ${sectionData.length} Kategori.`);

    } catch (error) {
      console.error(`   ❌ Hata [${langCode}]:`, error.message);
    } finally {
      await page.close();
    }
  }

  await browser.close();
  fs.writeFileSync('feed.json', JSON.stringify(fullFeed, null, 2), 'utf-8');
  console.log("\n🎉 Kral, işlem bitti! Resimli feed.json hazır.");
})();
