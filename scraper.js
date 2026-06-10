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
  console.log("🚀 OnyxMusic Otomatik Scraper Başlıyor (V2 - Optimize Sürüm)...");

  const browser = await puppeteer.launch({
    executablePath: process.env.PUPPETEER_EXECUTABLE_PATH, // Kendi yolun varsa kullanır, yoksa Puppeteer'ınkini kullanır
    headless: true, // İşlem bittikten sonra izlemek istersen false yapabilirsin
    args: [
      '--no-sandbox', 
      '--disable-setuid-sandbox', 
      '--disable-dev-shm-usage',
      '--disable-gpu' // Performans ve çökme engelleme için
    ]
  });

  const fullFeed = {};

  for (const [langCode, config] of Object.entries(REGIONS)) {
    const url = `https://www.youtube.com/feed/music`;
    console.log(`\n⏳ İşleniyor: [${langCode.toUpperCase()}] (Dil: ${config.hl}, Ülke: ${config.gl})`);
    
    const page = await browser.newPage();
    
    // Görüntü alanını geniş tutuyoruz ki yatayda daha çok kart dolsun
    await page.setViewport({ width: 1920, height: 1080 });
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/114.0.0.0 Safari/537.36');

    await page.setCookie({
      name: 'PREF',
      value: `hl=${config.hl}&gl=${config.gl}`,
      domain: '.youtube.com',
      path: '/'
    });

    await page.setCookie({
      name: 'SOCS',
      value: 'CAESEwgDEgk0ODE3Nzk3MjQaAmVuIAEaBgiA_LyaBg', // Çerez onayı pop-up'ını engeller
      domain: '.youtube.com',
      path: '/'
    });

    try {
      await page.goto(url, { waitUntil: 'networkidle2', timeout: 60000 });
      console.log(`   Sayfa yüklendi, aşağı kaydırılıyor...`);

      // 1. AŞAMA: Aşağı kaydırarak tüm kategorileri (rafları) yüklet
      await page.evaluate(async () => {
        await new Promise((resolve) => {
          let lastCardCount = 0;
          let stableRounds = 0;
          const timer = setInterval(() => {
            window.scrollBy(0, 500);
            const currentCount = document.querySelectorAll('ytd-rich-section-renderer, ytd-shelf-renderer').length;
            if (currentCount === lastCardCount) {
              stableRounds++;
              if (stableRounds >= 6) { // 6 tur boyunca yeni raf gelmezse dur
                clearInterval(timer);
                resolve();
              }
            } else {
              stableRounds = 0;
              lastCardCount = currentCount;
            }
          }, 800);
        });
      });

      console.log(`   Yatay listeler (sağ oklar) açılıyor...`);
      
      // 2. AŞAMA: Sağ oklara basarak gizli olan kartları (3'ten sonrakileri) yüklet
      await page.evaluate(async () => {
        const wait = (ms) => new Promise(res => setTimeout(res, ms));
        const rightArrows = document.querySelectorAll('#right-arrow button, yt-horizontal-list-renderer #right-arrow button');
        
        for (let arrow of rightArrows) {
          let attempts = 0;
          // Buton ekranda görünür olduğu ve disabled olmadığı sürece tıkla (Maksimum 10 kez tıkla ki sonsuz döngüye girmesin)
          while (arrow && arrow.offsetParent !== null && !arrow.hasAttribute('disabled') && !arrow.closest('[hidden]') && attempts < 10) {
            arrow.click();
            await wait(400); // Tıkladıktan sonra animasyonun bitmesi ve yeni resmin inmesi için bekle
            attempts++;
          }
        }
      });

      console.log(`   Veriler toplanıyor...`);

      // 3. AŞAMA: Hazır olan DOM'dan verileri çek
      const sectionData = await page.evaluate(() => {
        const sections = [];
        const elements = document.querySelectorAll('ytd-rich-section-renderer, ytd-shelf-renderer');
        
        for (let section of elements) {
          const sectionTitle = section.querySelector('#title, #title-text, yt-formatted-string')?.textContent?.trim();
          if (!sectionTitle) continue;

          const items = [];
          const seenIds = new Set();
          const cards = section.querySelectorAll('ytd-rich-item-renderer, ytd-grid-playlist-renderer, ytd-compact-playlist-renderer, yt-horizontal-list-renderer ytd-grid-video-renderer');
          
          for (let card of cards) {
            const linkEl = card.querySelector('a[href*="list=RDCLAK"], a[href*="list=PL"]');
            if (!linkEl) continue;
            
            const match = linkEl.href.match(/list=((?:RDCLAK|PL)[^&]+)/);
            if (!match) continue;
            
            const id = match[1];
            if (seenIds.has(id)) continue; // Aynı ID'yi iki kez ekleme

            // İsim Bulma
            let name = card.querySelector('#video-title')?.textContent?.trim() || card.querySelector('h3')?.textContent?.trim();
            if (!name) {
              card.querySelectorAll('a[href*="list=RDCLAK"], a[href*="list=PL"]').forEach(a => {
                const text = a.querySelector('span, yt-formatted-string')?.textContent?.trim() || a.textContent?.trim() || a.title;
                if (text && !text.match(/\d+\s*(şarkı|video|songs|videos|canciones)/i)) name = text;
              });
            }

            // Resim Bulma (Fetch yerine doğrudan ekrandan alıyoruz)
            let img = "";
            const imgEl = card.querySelector('yt-image img, img#img');
            if (imgEl && imgEl.src && !imgEl.src.includes('data:image')) {
              img = imgEl.src.split('?')[0]; // Temiz URL (Parametreleri siler)
            } else if (imgEl && imgEl.getAttribute('src')) {
                img = imgEl.getAttribute('src').split('?')[0];
            }

            // Eğer resim bulunamadıysa YouTube'un default kapak resmine düşür
            if (!img) {
              img = `https://i.ytimg.com/vi/${id.replace('RDCLAK', '')}/hqdefault.jpg`;
            }
            
            items.push({ id, name: name || "İsimsiz Playlist", img });
            seenIds.add(id);
          }
          if (items.length > 0) sections.push({ section_title: sectionTitle, items });
        }
        return sections;
      });

      fullFeed[langCode] = sectionData;
      console.log(`   ✅ ${sectionData.length} kategori başarıyla çekildi!`);

    } catch (error) {
      console.error(`   ❌ Hata oluştu [${langCode}]:`, error.message);
    } finally {
      await page.close(); // Sekmeyi kapatıp RAM'i temizliyoruz
    }
  }

  await browser.close();

  fs.writeFileSync('feed.json', JSON.stringify(fullFeed, null, 2), 'utf-8');
  console.log("\n🎉 İşlem Tamamlandı! Tüm diller feed.json dosyasına kaydedildi.");
})();
