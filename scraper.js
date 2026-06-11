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
  console.log("🚀 OnyxMusic Otomatik Scraper Başlıyor...");

  console.log('Chrome Path:', process.env.PUPPETEER_EXECUTABLE_PATH);
  const browser = await puppeteer.launch({
    executablePath: process.env.PUPPETEER_EXECUTABLE_PATH,
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  const fullFeed = {};

  for (const [langCode, config] of Object.entries(REGIONS)) {
    const url = `https://www.youtube.com/feed/music`;
    console.log(`\n⏳ İşleniyor: [${langCode.toUpperCase()}] (Dil: ${config.hl}, Ülke: ${config.gl})`);
    
    const page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/114.0.0.0 Safari/537.36');

    await page.setCookie({
      name: 'PREF',
      value: `hl=${config.hl}&gl=${config.gl}`,
      domain: '.youtube.com',
      path: '/'
    });

    await page.setCookie({
      name: 'SOCS',
      value: 'CAESEwgDEgk0ODE3Nzk3MjQaAmVuIAEaBgiA_LyaBg',
      domain: '.youtube.com',
      path: '/'
    });

    try {
      await page.goto(url, { waitUntil: 'networkidle2', timeout: 60000 });
      await delay(5000);

      console.log(`   Sayfa aşağı kaydırılıyor...`);

      // Tüm kart tiplerini sayarak scroll et
      await page.evaluate(async () => {
        await new Promise((resolve) => {
          let lastCardCount = 0;
          let stableRounds = 0;

          const timer = setInterval(() => {
            window.scrollBy(0, 400);

            const currentCount = document.querySelectorAll(
              'ytd-rich-item-renderer, ytd-grid-playlist-renderer, ytd-compact-playlist-renderer, ytd-lockup-view-model, ytd-reel-item-renderer'
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

      await delay(2000);

      const sectionData = await page.evaluate(async () => {
        const innerDelay = ms => new Promise(res => setTimeout(res, ms));
        
        async function getFirstVideoId(playlistId) {
          try {
            const res = await fetch(`https://www.youtube.com/playlist?list=${playlistId}`);
            const text = await res.text();
            const match = text.match(/"videoId":"([a-zA-Z0-9_-]{11})"/);
            return match ? match[1] : null;
          } catch (e) { return null; }
        }

        // Playlist ID'sini herhangi bir href'den çıkart
        function extractPlaylistId(href) {
          if (!href) return null;
          const match = href.match(/[?&]list=([A-Za-z0-9_-]+)/);
          return match ? match[1] : null;
        }

        // Kartten isim çıkart - tüm olası seçicileri dene
        function extractName(card) {
          const selectors = [
            '#video-title',
            'h3',
            '.yt-lockup-metadata-view-model-wiz__title',
            '.ytd-lockup-view-model-wiz__metadata-container h3',
            '[class*="title"] span',
            '[class*="title"]',
            'a span',
            'yt-formatted-string',
          ];
          for (const sel of selectors) {
            const el = card.querySelector(sel);
            const text = el?.textContent?.trim();
            if (text && text.length > 1 && !text.match(/^\d+$/)) return text;
          }
          // Son çare: tüm linklerin title/text'i
          let found = null;
          card.querySelectorAll('a[href*="list="]').forEach(a => {
            if (found) return;
            const text = a.title?.trim() || a.querySelector('span, yt-formatted-string')?.textContent?.trim() || a.textContent?.trim();
            if (text && text.length > 1 && !text.match(/\d+\s*(şarkı|video|songs|videos|canciones|canzoni|lieder)/i)) {
              found = text;
            }
          });
          return found;
        }

        const sections = [];
        const elements = document.querySelectorAll('ytd-rich-section-renderer, ytd-shelf-renderer');
        
        for (let section of elements) {
          const sectionTitle = section.querySelector('#title, #title-text, yt-formatted-string')?.textContent?.trim();
          if (!sectionTitle) continue;

          const items = [];
          const seenIds = new Set();

          // TÜM kart tiplerini yakala
          const cards = section.querySelectorAll(
            'ytd-rich-item-renderer, ytd-grid-playlist-renderer, ytd-compact-playlist-renderer, ytd-lockup-view-model, ytd-reel-item-renderer'
          );
          
          for (let card of cards) {
            // Karttaki tüm list= linklerini tara
            const allLinks = card.querySelectorAll('a[href*="list="]');
            let playlistId = null;
            
            for (const link of allLinks) {
              const id = extractPlaylistId(link.href);
              if (id && !seenIds.has(id)) {
                playlistId = id;
                break;
              }
            }

            if (!playlistId) continue;
            if (seenIds.has(playlistId)) continue;

            const name = extractName(card) || "İsimsiz";
            const videoId = await getFirstVideoId(playlistId);
            const img = videoId ? `https://i.ytimg.com/vi/${videoId}/maxresdefault.jpg` : "";
            
            items.push({ id: playlistId, name, img });
            seenIds.add(playlistId);
            
            await innerDelay(200); 
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
      await page.close();
    }
  }

  await browser.close();

  // ✅ TIMESTAMP: Her run'da feed.json değişsin, git her zaman commit atsın
  const output = {
    updated_at: new Date().toISOString(),
    feed: fullFeed
  };

  fs.writeFileSync('feed.json', JSON.stringify(output, null, 2), 'utf-8');
  console.log("\n🎉 İşlem Tamamlandı! Tüm diller feed.json dosyasına kaydedildi.");
})();
