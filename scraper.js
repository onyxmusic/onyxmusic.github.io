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

// Fetch işlemini tarayıcıdan (page.evaluate) Node.js tarafına aldık.
async function getFirstVideoIdNode(playlistId) {
  try {
    const res = await fetch(`https://www.youtube.com/playlist?list=${playlistId}`, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/114.0.0.0 Safari/537.36'
      }
    });
    const text = await res.text();
    const match = text.match(/"videoId":"([a-zA-Z0-9_-]{11})"/);
    return match ? match[1] : null;
  } catch (e) {
    return null;
  }
}

(async () => {
  console.log("🚀 OnyxMusic Otomatik Scraper Başlıyor...");

  // Ortam değişkeni yoksa standart yolu bulabilmesi için fallback eklendi.
  const browser = await puppeteer.launch({
    executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
    headless: "new", // Modern ve daha stabil headless modu
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
  });

  const fullFeed = {};

  for (const [langCode, config] of Object.entries(REGIONS)) {
    const url = `https://www.youtube.com/feed/music`;
    console.log(`\n⏳ İşleniyor: [${langCode.toUpperCase()}] (Dil: ${config.hl}, Ülke: ${config.gl})`);
    
    const page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/114.0.0.0 Safari/537.36');

    await page.setCookie({ name: 'PREF', value: `hl=${config.hl}&gl=${config.gl}`, domain: '.youtube.com', path: '/' });
    await page.setCookie({ name: 'SOCS', value: 'CAESEwgDEgk0ODE3Nzk3MjQaAmVuIAEaBgiA_LyaBg', domain: '.youtube.com', path: '/' });

    try {
      await page.goto(url, { waitUntil: 'networkidle2', timeout: 60000 });
      await delay(3000); // Gereksiz uzun beklemeyi biraz kısalttık

      console.log(`   Sayfa aşağı kaydırılıyor...`);

      await page.evaluate(async () => {
        await new Promise((resolve) => {
          let lastCardCount = 0;
          let stableRounds = 0;

          const timer = setInterval(() => {
            window.scrollBy(0, 400);
            const currentCount = document.querySelectorAll(
              'ytd-rich-item-renderer, ytd-grid-playlist-renderer, ytd-compact-playlist-renderer, ytd-lockup-view-model'
            ).length;

            if (currentCount === lastCardCount) {
              stableRounds++;
              if (stableRounds >= 8) {
                clearInterval(timer);
                resolve();
              }
            } else {
              stableRounds = 0;
              lastCardCount = currentCount;
            }
          }, 600);
        });
      });

      await delay(1500);

      // Tarayıcı içinde SADECE DOM okuma yapıyoruz. Ağ isteklerini kaldırdık.
      const rawSections = await page.evaluate(() => {
        const sections = [];
        const elements = document.querySelectorAll('ytd-rich-section-renderer, ytd-shelf-renderer');
        
        for (let section of elements) {
          const sectionTitle = section.querySelector('#title, #title-text, yt-formatted-string')?.textContent?.trim();
          if (!sectionTitle) continue;

          const items = [];
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

            items.push({ id, name: name || "İsimsiz" });
            seenIds.add(id);
          }
          if (items.length > 0) sections.push({ section_title: sectionTitle, items });
        }
        return sections;
      });

      console.log(`   Kapak fotoğrafları çekiliyor (${rawSections.length} kategori)...`);

      // Node.js tarafında Promise.all ile paralel Fetch atarak hızı artırıyoruz.
      const processedSections = [];
      for (const section of rawSections) {
        const processedItems = await Promise.all(
          section.items.map(async (item) => {
            const videoId = await getFirstVideoIdNode(item.id);
            const img = videoId ? `https://i.ytimg.com/vi/${videoId}/maxresdefault.jpg` : "";
            return { ...item, img };
          })
        );
        processedSections.push({ section_title: section.section_title, items: processedItems });
      }

      fullFeed[langCode] = processedSections;
      console.log(`   ✅ Veriler başarıyla işlendi!`);

    } catch (error) {
      console.error(`   ❌ Hata oluştu [${langCode}]:`, error.message);
    } finally {
      await page.close();
    }
  }

  await browser.close();

  fs.writeFileSync('feed.json', JSON.stringify(fullFeed, null, 2), 'utf-8');
  console.log("\n🎉 İşlem Tamamlandı! Tüm diller feed.json dosyasına kaydedildi.");
})();
