const puppeteer = require('puppeteer');
const fs = require('fs');
const https = require('https');
const http = require('http');
const path = require('path');

const GITHUB_TOKEN = process.env.THUMBNAILS_TOKEN;
const GITHUB_REPO = 'onyxmusic/onyxmusic.github.io';
const GITHUB_BRANCH = 'main';
const THUMBNAILS_DIR = 'thumbnails';

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

// GitHub'da dosya var mı kontrol et
async function checkFileExistsOnGitHub(filePath) {
  return new Promise((resolve) => {
    const options = {
      hostname: 'api.github.com',
      path: `/repos/${GITHUB_REPO}/contents/${filePath}`,
      method: 'GET',
      headers: {
        'Authorization': `token ${GITHUB_TOKEN}`,
        'User-Agent': 'OnyxMusic-Scraper',
        'Accept': 'application/vnd.github.v3+json'
      }
    };
    const req = https.request(options, (res) => {
      resolve(res.statusCode === 200);
    });
    req.on('error', () => resolve(false));
    req.end();
  });
}

// Resmi URL'den indir
async function downloadImage(url) {
  return new Promise((resolve, reject) => {
    const protocol = url.startsWith('https') ? https : http;
    protocol.get(url, (res) => {
      if (res.statusCode === 301 || res.statusCode === 302) {
        downloadImage(res.headers.location).then(resolve).catch(reject);
        return;
      }
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => resolve(Buffer.concat(chunks)));
      res.on('error', reject);
    }).on('error', reject);
  });
}

// GitHub'a resim yükle
async function uploadToGitHub(filePath, imageBuffer) {
  const base64Content = imageBuffer.toString('base64');

  // Önce mevcut SHA'yı al (güncelleme için gerekli)
  let sha = null;
  await new Promise((resolve) => {
    const options = {
      hostname: 'api.github.com',
      path: `/repos/${GITHUB_REPO}/contents/${filePath}`,
      method: 'GET',
      headers: {
        'Authorization': `token ${GITHUB_TOKEN}`,
        'User-Agent': 'OnyxMusic-Scraper',
        'Accept': 'application/vnd.github.v3+json'
      }
    };
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { sha = JSON.parse(data).sha; } catch (_) {}
        resolve();
      });
    });
    req.on('error', () => resolve());
    req.end();
  });

  // Yükle
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      message: `🖼️ Add thumbnail: ${path.basename(filePath)}`,
      content: base64Content,
      branch: GITHUB_BRANCH,
      ...(sha ? { sha } : {})
    });

    const options = {
      hostname: 'api.github.com',
      path: `/repos/${GITHUB_REPO}/contents/${filePath}`,
      method: 'PUT',
      headers: {
        'Authorization': `token ${GITHUB_TOKEN}`,
        'User-Agent': 'OnyxMusic-Scraper',
        'Accept': 'application/vnd.github.v3+json',
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body)
      }
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        if (res.statusCode === 200 || res.statusCode === 201) {
          resolve(true);
        } else {
          console.error(`GitHub yükleme hatası: ${res.statusCode} - ${data}`);
          resolve(false);
        }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

// Playlist için thumbnail işle - var mı kontrol et, yoksa indir ve yükle
async function getOrUploadThumbnail(playlistId, thumbnailUrl) {
  const fileName = `${THUMBNAILS_DIR}/${playlistId}.jpg`;
  const rawGitHubUrl = `https://raw.githubusercontent.com/${GITHUB_REPO}/${GITHUB_BRANCH}/${fileName}`;

  // GitHub'da zaten var mı?
  const exists = await checkFileExistsOnGitHub(fileName);
  if (exists) {
    console.log(`   ⚡ Zaten var, atlandı: ${playlistId}`);
    return rawGitHubUrl;
  }

  // Yoksa indir ve yükle
  try {
    console.log(`   📥 İndiriliyor: ${playlistId}`);
    const imageBuffer = await downloadImage(thumbnailUrl);
    const uploaded = await uploadToGitHub(fileName, imageBuffer);
    if (uploaded) {
      console.log(`   ✅ GitHub'a yüklendi: ${playlistId}`);
      return rawGitHubUrl;
    }
  } catch (e) {
    console.error(`   ❌ Thumbnail yükleme hatası (${playlistId}):`, e.message);
  }

  // Hata olursa eski ilk video linkini döndür
  return null;
}

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

      // ── 1. SCROLL ──
      console.log(`   Sayfa aşağı kaydırılıyor...`);
      await page.evaluate(async () => {
        await new Promise((resolve) => {
          let lastCount = 0;
          let stableRounds = 0;
          const timer = setInterval(() => {
            window.scrollBy(0, 400);
            const currentCount = document.querySelectorAll(
              'ytd-rich-item-renderer, ytd-grid-playlist-renderer, ytd-compact-playlist-renderer, ytd-lockup-view-model, ytd-reel-item-renderer'
            ).length;
            if (currentCount === lastCount) {
              stableRounds++;
              if (stableRounds >= 8) { clearInterval(timer); resolve(); }
            } else {
              stableRounds = 0;
              lastCount = currentCount;
            }
          }, 600);
        });
      });

      await delay(2000);

      // ── 2. DAHA FAZLA GÖSTER ──
      let expandRound = 0;
      while (expandRound < 10) {
        const clicked = await page.evaluate(() => {
          const buttons = Array.from(document.querySelectorAll('button, tp-yt-paper-button, yt-button-shape button')).filter(btn => {
            const text = (btn.textContent || '').trim().toLowerCase();
            return (
              text.includes('daha fazla') || text.includes('show more') ||
              text.includes('ver más') || text.includes('plus') ||
              text.includes('mehr') || text.includes('altro') ||
              text.includes('mais') || text.includes('ещё') ||
              text.includes('المزيد') || text.includes('もっと見る') ||
              text.includes('और देखें') || text.includes('更多')
            );
          });
          if (buttons.length === 0) return 0;
          buttons.forEach(btn => btn.click());
          return buttons.length;
        });

        if (clicked === 0) break;
        console.log(`   📂 ${clicked} "Daha fazla göster" butonu tıklandı...`);
        await delay(1500);
        expandRound++;
      }

      await delay(1000);

      // ── 3. VERİYİ ÇEK ──
      const sectionData = await page.evaluate(async () => {
        const innerDelay = ms => new Promise(res => setTimeout(res, ms));

        async function getPlaylistInfo(playlistId) {
          try {
            const res = await fetch(`https://www.youtube.com/playlist?list=${playlistId}`);
            const text = await res.text();

            // Orjinal playlist thumbnail'ını çek
            const thumbMatch = text.match(/"og:image"\s+content="([^"]+)"/);
            const thumbnailUrl = thumbMatch ? thumbMatch[1] : null;

            // İlk video ID'sini de çek (fallback için)
            const videoMatch = text.match(/"videoId":"([a-zA-Z0-9_-]{11})"/);
            const firstVideoId = videoMatch ? videoMatch[1] : null;

            return { thumbnailUrl, firstVideoId };
          } catch (e) {
            return { thumbnailUrl: null, firstVideoId: null };
          }
        }

        function extractPlaylistId(href) {
          if (!href) return null;
          const match = href.match(/[?&]list=([A-Za-z0-9_-]+)/);
          return match ? match[1] : null;
        }

        function extractName(card) {
          const selectors = [
            '#video-title', 'h3',
            '.yt-lockup-metadata-view-model-wiz__title',
            '[class*="title"] span', '[class*="title"]',
            'yt-formatted-string',
          ];
          for (const sel of selectors) {
            const text = card.querySelector(sel)?.textContent?.trim();
            if (text && text.length > 1 && !text.match(/^\d+$/)) return text;
          }
          let found = null;
          card.querySelectorAll('a[href*="list="]').forEach(a => {
            if (found) return;
            const text = a.title?.trim()
              || a.querySelector('span, yt-formatted-string')?.textContent?.trim()
              || a.textContent?.trim();
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

          const cards = section.querySelectorAll(
            'ytd-rich-item-renderer, ytd-grid-playlist-renderer, ytd-compact-playlist-renderer, ytd-lockup-view-model, ytd-reel-item-renderer'
          );

          for (let card of cards) {
            let playlistId = null;
            for (const link of card.querySelectorAll('a[href*="list="]')) {
              const id = extractPlaylistId(link.href);
              if (id && !seenIds.has(id)) { playlistId = id; break; }
            }
            if (!playlistId) continue;

            const name = extractName(card) || 'İsimsiz';
            const { thumbnailUrl, firstVideoId } = await getPlaylistInfo(playlistId);

            // thumbnailUrl = orjinal playlist kapağı (sqp= parametreli, geçici)
            // firstVideoId = fallback için
            items.push({
              id: playlistId,
              name,
              thumbnailUrl, // GitHub'a yüklemek için geçici saklıyoruz
              firstVideoId  // fallback için
            });
            seenIds.add(playlistId);
            await innerDelay(200);
          }

          if (items.length > 0) sections.push({ section_title: sectionTitle, items });
        }
        return sections;
      });

      // ── 4. THUMBNAIL'LARI GITHUB'A YÜKLE ──
      console.log(`   🖼️ Thumbnail'lar GitHub'a yükleniyor...`);
      for (const section of sectionData) {
        for (const item of section.items) {
          let finalImg = null;

          if (item.thumbnailUrl) {
            // Orjinal playlist kapağını GitHub'a yükle
            finalImg = await getOrUploadThumbnail(item.id, item.thumbnailUrl);
          }

          // Fallback: orjinal yoksa ilk video
          if (!finalImg && item.firstVideoId) {
            finalImg = `https://i.ytimg.com/vi/${item.firstVideoId}/maxresdefault.jpg`;
          }

          // Temizle, sadece id, name, img kalsın
          item.img = finalImg || '';
          delete item.thumbnailUrl;
          delete item.firstVideoId;

          await delay(300); // GitHub API rate limit için
        }
      }

      fullFeed[langCode] = sectionData;
      console.log(`   ✅ ${sectionData.length} kategori başarıyla çekildi!`);

    } catch (error) {
      console.error(`   ❌ Hata oluştu [${langCode}]:`, error.message);
    } finally {
      await page.close();
    }
  }

  await browser.close();

  const output = {
    updated_at: new Date().toISOString(),
    feed: fullFeed
  };

  fs.writeFileSync('feed.json', JSON.stringify(output, null, 2), 'utf-8');
  console.log("\n🎉 İşlem Tamamlandı! Tüm diller feed.json dosyasına kaydedildi.");
})();
