const puppeteer = require('puppeteer');
const fs = require('fs');

const REGIONS = {
  tr: { gl: 'TR', hl: 'tr' },
  en: { gl: 'US', hl: 'en' },
  fr: { gl: 'FR', hl: 'fr' },
  de: { gl: 'DE', hl: 'de' },
  es: { gl: 'ES', hl: 'es' },
  it: { gl: 'IT', hl: 'it' },
  pt: { gl: 'BR', hl: 'pt' },
  ru: { gl: 'RU', hl: 'ru' },
  ar: { gl: 'AE', hl: 'ar' },
  ja: { gl: 'JP', hl: 'ja' },
  hi: { gl: 'IN', hl: 'hi' },
  zh: { gl: 'TW', hl: 'zh-TW' }
};

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function autoScroll(page, {
  maxRounds = 70,
  stableRoundsToStop = 6,
  waitMs = 1200
} = {}) {
  let lastCount = -1;
  let lastHeight = -1;
  let stableRounds = 0;

  for (let i = 0; i < maxRounds; i++) {
    await page.evaluate(() => {
      const delta = Math.max(window.innerHeight * 0.9, 900);

      const targets = [
        document.scrollingElement,
        document.querySelector('ytd-app'),
        document.querySelector('#content'),
        document.body
      ].filter(Boolean);

      for (const el of targets) {
        try {
          el.scrollTop = (el.scrollTop || 0) + delta;
        } catch {}
        try {
          el.scrollBy(0, delta);
        } catch {}
      }

      window.scrollBy(0, delta);
    });

    // Scroll event'in gerçekten işlenmesi için küçük bekleme
    await delay(waitMs);

    const [count, height] = await Promise.all([
      page.evaluate((selector) => document.querySelectorAll(selector).length,
        [
          'ytd-rich-item-renderer',
          'ytd-grid-playlist-renderer',
          'ytd-compact-playlist-renderer',
          'ytd-rich-grid-media',
          'ytd-playlist-renderer',
          'ytmusic-responsive-list-item-renderer',
          'ytmusic-shelf-renderer',
          'ytd-rich-section-renderer',
          'ytd-shelf-renderer'
        ].join(',')
      ),
      page.evaluate(() =>
        Math.max(
          document.documentElement.scrollHeight,
          document.body.scrollHeight,
          document.documentElement.offsetHeight,
          document.body.offsetHeight
        )
      )
    ]);

    const sameCount = count === lastCount;
    const sameHeight = height === lastHeight;

    if (sameCount && sameHeight) {
      stableRounds++;
    } else {
      stableRounds = 0;
      lastCount = count;
      lastHeight = height;
    }

    if (stableRounds >= stableRoundsToStop) {
      break;
    }
  }
}

(async () => {
  console.log('🚀 OnyxMusic Otomatik Scraper Başlıyor...');
  console.log('Chrome Path:', process.env.PUPPETEER_EXECUTABLE_PATH);

  const browser = await puppeteer.launch({
    executablePath: process.env.PUPPETEER_EXECUTABLE_PATH,
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  const fullFeed = {};

  try {
    for (const [langCode, config] of Object.entries(REGIONS)) {
      const url = 'https://www.youtube.com/feed/music';
      console.log(`\n⏳ İşleniyor: [${langCode.toUpperCase()}] (Dil: ${config.hl}, Ülke: ${config.gl})`);

      const page = await browser.newPage();
      await page.setViewport({ width: 1600, height: 2200 });
      await page.setUserAgent(
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/114.0.0.0 Safari/537.36'
      );

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
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });

        // Sayfanın ana içerikleri gelsin
        await page.waitForSelector('ytd-rich-section-renderer, ytd-shelf-renderer', { timeout: 30000 }).catch(() => {});
        await delay(4000);

        console.log('   Sayfa kaydırılıyor...');
        await autoScroll(page, {
          maxRounds: 90,
          stableRoundsToStop: 7,
          waitMs: 1100
        });

        await delay(2000);

        const sectionData = await page.evaluate(async () => {
          const innerDelay = (ms) => new Promise((res) => setTimeout(res, ms));

          async function getFirstVideoId(playlistId) {
            try {
              const res = await fetch(`https://www.youtube.com/playlist?list=${playlistId}`, {
                credentials: 'include'
              });
              const text = await res.text();
              const match = text.match(/"videoId":"([a-zA-Z0-9_-]{11})"/);
              return match ? match[1] : null;
            } catch (e) {
              return null;
            }
          }

          function getSectionTitleFromCard(card) {
            const section = card.closest(
              'ytd-rich-section-renderer, ytd-shelf-renderer, ytd-rich-shelf-renderer, ytd-item-section-renderer'
            );

            if (!section) return 'Diğer';

            const titleEl = section.querySelector(
              '#title, #title-text, yt-formatted-string#title, yt-formatted-string'
            );

            const title = titleEl?.textContent?.trim();
            return title || 'Diğer';
          }

          const cards = document.querySelectorAll(
            [
              'ytd-rich-item-renderer',
              'ytd-grid-playlist-renderer',
              'ytd-compact-playlist-renderer',
              'ytd-playlist-renderer',
              'ytmusic-responsive-list-item-renderer'
            ].join(',')
          );

          const grouped = new Map();

          for (const card of cards) {
            const linkEl = card.querySelector('a[href*="list="]');
            if (!linkEl) continue;

            const href = linkEl.getAttribute('href') || linkEl.href || '';
            const match = href.match(/[?&]list=([^&]+)/);
            if (!match) continue;

            const id = decodeURIComponent(match[1]);
            if (!id) continue;

            const sectionTitle = getSectionTitleFromCard(card);
            if (!grouped.has(sectionTitle)) grouped.set(sectionTitle, new Map());

            const sectionMap = grouped.get(sectionTitle);
            if (sectionMap.has(id)) continue;

            let name =
              card.querySelector('#video-title')?.textContent?.trim() ||
              card.querySelector('h3')?.textContent?.trim() ||
              linkEl.textContent?.trim() ||
              linkEl.title?.trim() ||
              'İsimsiz';

            // "12 videos", "34 songs" gibi sayı etiketlerini ayıkla
            if (/^\d+\s*(şarkı|video|songs|videos|canciones)/i.test(name)) {
              name = linkEl.title?.trim() || 'İsimsiz';
            }

            const videoId = await getFirstVideoId(id);
            const img = videoId ? `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg` : '';

            sectionMap.set(id, { id, name, img });
            await innerDelay(120);
          }

          return [...grouped.entries()].map(([section_title, itemsMap]) => ({
            section_title,
            items: [...itemsMap.values()]
          }));
        });

        fullFeed[langCode] = sectionData;
        console.log(`   ✅ ${sectionData.length} kategori başarıyla çekildi!`);

      } catch (error) {
        console.error(`   ❌ Hata oluştu [${langCode}]:`, error.message);
      } finally {
        await page.close();
      }
    }

    fs.writeFileSync('feed.json', JSON.stringify(fullFeed, null, 2), 'utf-8');
    console.log('\n🎉 İşlem Tamamlandı! Tüm diller feed.json dosyasına kaydedildi.');
  } finally {
    await browser.close();
  }
})();
