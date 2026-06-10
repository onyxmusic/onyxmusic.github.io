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

(async () => {
  console.log("🚀 OnyxMusic Otomatik Scraper Başlıyor (Fetch Aktif, Sınır Kaldırıldı!)...");

  const browser = await puppeteer.launch({
    executablePath: process.env.PUPPETEER_EXECUTABLE_PATH,
    headless: true, // Neler yaptığını görmek istersen bunu false yapabilirsin
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  const fullFeed = {};

  for (const [langCode, config] of Object.entries(REGIONS)) {
    const url = `https://www.youtube.com/feed/music`;
    console.log(`\n⏳ İşleniyor: [${langCode.toUpperCase()}] (Dil: ${config.hl}, Ülke: ${config.gl})`);
    
    const page = await browser.newPage();
    
    // Genişliği devasa yaptık ki YouTube daha fazla kartı aynı anda yüklesin
    await page.setViewport({ width: 2560, height: 1440 });
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
      console.log(`   Sayfa aşağı kaydırılarak ana başlıklar yükletiliyor...`);

      // 1. AŞAMA: Sayfanın en altına kadar inmeyi sağla
      await page.evaluate(async () => {
        await new Promise((resolve) => {
          let lastCount = 0;
          let stableRounds = 0;
          const timer = setInterval(() => {
            window.scrollBy(0, 600);
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

      console.log(`   Yatay listeler (sağ oklar) sonuna kadar açılıyor... (Lütfen bekleyin)`);

      // 2. AŞAMA: İŞTE O SORUNU ÇÖZEN YENİ KOD. 
      // Sadece 4 tane çıkmasını engelleyen, sağdaki tüm gizli listeleri açan bölüm.
      await page.evaluate(async () => {
        const wait = (ms) => new Promise(res => setTimeout(res, ms));
        let round = 0;
        
        // 30 tura kadar dön (Yani bir kategoride 30 kere sağa kaydırabilir)
        while (round < 30) {
          let clickedAny = false;
          // YouTube'un sağ ok butonlarının barındığı ana kapsayıcıyı bul
          const rightArrowsContainers = document.querySelectorAll('#right-arrow');
          
          for (let container of rightArrowsContainers) {
            // Eğer YouTube oku "gizlemediyse" (yani sağda hala müzik listesi varsa) tıkla!
            if (!container.hasAttribute('hidden') && getComputedStyle(container).display !== 'none') {
              const btn = container.querySelector('button');
              if (btn) {
                btn.click();
                clickedAny = true;
              }
            }
          }
          
          // Eğer bu turda tıklanacak hiçbir sağ ok kalmadıysa, tüm raflar tam açılmış demektir. Çık.
          if (!clickedAny) break;
          
          // Tıkladıktan sonra YouTube'un listeyi kaydırması ve HTML'i oluşturması için 1 saniye bekle
          await wait(1000);
          round++;
        }
      });

      console.log(`   Tüm listeler açıldı! Fetch ile resimler çekiliyor...`);

      // 3. AŞAMA: Senin efsane Fetch yöntemin ile verileri toplama
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

        const sections = [];
        const elements = document.querySelectorAll('ytd-rich-section-renderer, ytd-shelf-renderer');
        
        for (let section of elements) {
          const sectionTitle = section.querySelector('#title, #title-text, yt-formatted-string')?.textContent?.trim();
          if (!sectionTitle) continue;

          const items = [];
          const seenIds = new Set();
          
          const cards = section.querySelectorAll('a[href*="list=RDCLAK"], a[href*="list=PL"]');
          
          for (let linkEl of cards) {
            const match = linkEl.href.match(/list=((?:RDCLAK|PL)[^&]+)/);
            if (!match) continue;
            
            const id = match[1];
            if (seenIds.has(id)) continue;

            let name = "";
            let parentCard = linkEl.closest('ytd-rich-item-renderer, ytd-grid-playlist-renderer, ytd-compact-station-renderer, ytd-playlist-renderer');
            if (parentCard) {
              name = parentCard.querySelector('#video-title, #title, h3')?.textContent?.trim();
            }
            
            if (!name) {
              name = linkEl.querySelector('span, yt-formatted-string')?.textContent?.trim() || linkEl.textContent?.trim() || linkEl.title;
            }

            if (name && name.match(/\d+\s*(şarkı|video|songs|videos|canciones)/i)) continue;
            if (!name) continue;

            // Fetch Kullanarak Fotoğraf Çekme İşlemi (Senin Orijinal Kodun)
            const videoId = await getFirstVideoId(id);
            const img = videoId ? `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg` : `https://i.ytimg.com/vi/${id.replace('RDCLAK', '')}/maxresdefault.jpg
            
            items.push({ id, name, img });
            seenIds.add(id);
            
            // Ban yememek için çok kısa bekleme
            await innerDelay(150);
          }
          if (items.length > 0) sections.push({ section_title: sectionTitle, items });
        }
        return sections;
      });

      fullFeed[langCode] = sectionData;
      let totalPlaylists = sectionData.reduce((acc, curr) => acc + curr.items.length, 0);
      console.log(`   ✅ ${sectionData.length} başlık altından, toplam ${totalPlaylists} playlist başarıyla çekildi!`);

    } catch (error) {
      console.error(`   ❌ Hata oluştu [${langCode}]:`, error.message);
    } finally {
      await page.close();
    }
  }

  await browser.close();

  fs.writeFileSync('feed.json', JSON.stringify(fullFeed, null, 2), 'utf-8');
  console.log("\n🎉 İşlem Tamamlandı! Tüm diller feed.json dosyasına eksiksiz olarak kaydedildi.");
})();
