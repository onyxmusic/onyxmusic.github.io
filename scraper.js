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
  console.log("🚀 OnyxMusic Otomatik Scraper Başlıyor (Fetch Aktif, Tam Kapsamlı Sürüm)...");

  const browser = await puppeteer.launch({
    executablePath: process.env.PUPPETEER_EXECUTABLE_PATH,
    headless: true, // İşlemi görmek istersen false yapabilirsin
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  const fullFeed = {};

  for (const [langCode, config] of Object.entries(REGIONS)) {
    const url = `https://www.youtube.com/feed/music`;
    console.log(`\n⏳ İşleniyor: [${langCode.toUpperCase()}] (Dil: ${config.hl}, Ülke: ${config.gl})`);
    
    const page = await browser.newPage();
    await page.setViewport({ width: 1920, height: 1080 }); // Geniş ekran, daha çok kart gösterir
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
      console.log(`   Sayfa aşağı kaydırılarak ana bölümler yükletiliyor...`);

      // 1. AŞAMA: Aşağı kaydır ve tüm rafları yükle
      await page.evaluate(async () => {
        await new Promise((resolve) => {
          let lastCount = 0;
          let stableRounds = 0;
          const timer = setInterval(() => {
            window.scrollBy(0, 500);
            const currentCount = document.querySelectorAll('ytd-rich-section-renderer, ytd-shelf-renderer').length;
            if (currentCount === lastCount) {
              stableRounds++;
              if (stableRounds >= 5) {
                clearInterval(timer);
                resolve();
              }
            } else {
              stableRounds = 0;
              lastCount = currentCount;
            }
          }, 800);
        });
      });

      console.log(`   Yatay listeler (sağ oklar) sonuna kadar açılıyor... Bu işlem biraz sürebilir.`);

      // 2. AŞAMA: Her yatay listeyi bul ve sonuna kadar sağ oka tıkla (4 tane sınırını kaldıran kod)
      await page.evaluate(async () => {
        const wait = (ms) => new Promise(res => setTimeout(res, ms));
        const carousels = document.querySelectorAll('yt-horizontal-list-renderer');
        
        for (let carousel of carousels) {
          let rightArrowContainer = carousel.querySelector('#right-arrow');
          let rightBtn = rightArrowContainer ? rightArrowContainer.querySelector('button') : null;
          let attempts = 0;
          
          // Ok butonu varsa ve gizli (hidden) değilse tıklamaya devam et
          while (rightArrowContainer && !rightArrowContainer.hasAttribute('hidden') && attempts < 20) {
            if (rightBtn) {
              rightBtn.click();
              await wait(800); // Tıkladıktan sonra yeni kartların DOM'a inmesini bekle
            }
            attempts++;
          }
        }
      });

      console.log(`   Veriler toplanıyor ve Fetch ile resimler çekiliyor...`);

      // 3. AŞAMA: Fetch ile ID ve Verileri Çekme (Senin istediğin orijinal yöntem)
      const sectionData = await page.evaluate(async () => {
        const innerDelay = ms => new Promise(res => setTimeout(res, ms));
        
        // Fotoğrafları getiren fetch fonksiyonu
        async function getFirstVideoId(playlistId) {
          try {
            const res = await fetch(`https://www.youtube.com/playlist?list=${playlistId}`);
            const text = await res.text();
            const match = text.match(/"videoId":"([a-zA-Z0-9_-]{11})"/);
            return match ? match[1] : null;
          } catch (e) { return null; }
        }

        const sections = [];
        const elements = document.querySelectorAll('ytd-rich-section-renderer, ytd-shelf-renderer');
        
        for (let section of elements) {
          const sectionTitle = section.querySelector('#title, #title-text, yt-formatted-string')?.textContent?.trim();
          if (!sectionTitle) continue;

          const items = [];
          const seenIds = new Set();
          
          // Rafın içindeki tüm oynatma listesi linklerini bul (Artık oklara bastığımız için 4'ten fazla çıkacak)
          const cards = section.querySelectorAll('a[href*="list=RDCLAK"], a[href*="list=PL"]');
          
          for (let linkEl of cards) {
            const match = linkEl.href.match(/list=((?:RDCLAK|PL)[^&]+)/);
            if (!match) continue;
            
            const id = match[1];
            if (seenIds.has(id)) continue;

            // İsim Bulma
            let name = "";
            let parentCard = linkEl.closest('ytd-rich-item-renderer, ytd-grid-playlist-renderer, ytd-compact-station-renderer, ytd-playlist-renderer');
            if (parentCard) {
              name = parentCard.querySelector('#video-title, #title, h3')?.textContent?.trim();
            }
            
            if (!name) {
              name = linkEl.querySelector('span, yt-formatted-string')?.textContent?.trim() || linkEl.textContent?.trim() || linkEl.title;
            }

            // Temizleme işlemi ("50 şarkı" vs. yazıyorsa yoksay)
            if (name && name.match(/\d+\s*(şarkı|video|songs|videos|canciones)/i)) continue;
            if (!name) continue;

            // Fetch ile Resmi Çek
            const videoId = await getFirstVideoId(id);
            const img = videoId ? `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg` : `https://i.ytimg.com/vi/${id.replace('RDCLAK', '')}/hqdefault.jpg`;
            
            items.push({ id, name, img });
            seenIds.add(id);
            
            await innerDelay(300); // Üst üste çok hızlı fetch atıp ban yememek için 0.3 sn bekle
          }
          if (items.length > 0) sections.push({ section_title: sectionTitle, items });
        }
        return sections;
      });

      fullFeed[langCode] = sectionData;
      
      // Kaç öğe çekildiğini hesapla ve ekrana yazdır
      let totalPlaylists = sectionData.reduce((acc, curr) => acc + curr.items.length, 0);
      console.log(`   ✅ ${sectionData.length} kategori, toplam ${totalPlaylists} playlist başarıyla çekildi!`);

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
