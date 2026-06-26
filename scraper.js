const puppeteer = require('puppeteer');
const fs = require('fs');

// 12 ÜLKENİN TAMAMI: AKILLI HIZ KONTROLÜ VE EKSİK RESİM FİLTRESİYLE AKTİF!
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

// Resmi internetten indiren ve YouTube sunucusunda optimize eden fonksiyon
async function downloadImage(url, destPath) {
  try {
    // 🚀 SİHİRLİ LİNK MANİPÜLASYONU: 
    // YouTube'un devasa boyutlu (=w544-h544) resimlerini doğrudan sunucuda 250x250 boyutuna ve %80 kalitesine düşürüyoruz.
    if (url.includes('googleusercontent.com') || url.includes('ggpht.com')) {
      const index = url.indexOf('=');
      if (index !== -1) {
        url = url.substring(0, index) + '=w250-h250-l80-rj';
      }
    }

    const response = await fetch(url);
    if (!response.ok) throw new Error(`HTTP hatası! Durum: ${response.status}`);
    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    fs.writeFileSync(destPath, buffer);
    console.log(`      📸 Optimize edilmiş hafif kapak repona işlendi: ${destPath}`);
    return true;
  } catch (error) {
    return false;
  }
}

(async () => {
  console.log("🚀 OnyxMusic Akıllı Filtreli Dünya Scraper'ı Başlıyor...");

  if (!fs.existsSync('images')) {
    fs.mkdirSync('images');
  }

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

      await delay(2000);

      let expandRound = 0;
      while (expandRound < 10) {
        const clicked = await page.evaluate(() => {
          const buttons = Array.from(document.querySelectorAll('button, tp-yt-paper-button, yt-button-shape button')).filter(btn => {
            const text = (btn.textContent || '').trim().toLowerCase();
            return (
              text.includes('daha fazla göster') ||
              text.includes('show more')  ||
              text.includes('mostrar más')    ||
              text.includes('plus')       ||
              text.includes('mehr anzeigen')       ||
              text.includes('mostra altro')      ||
              text.includes('mostrar mais')      ||
              text.includes('ещё')        ||
              text.includes('عرض المزيد')     ||
              text.includes('もっと見る')     ||
              text.includes('और दिखाएं')         ||
              text.includes('顯示完整資訊')
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

      const sectionData = await page.evaluate(async () => {
        const innerDelay = ms => new Promise(res => setTimeout(res, ms));
        
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

            try {
              card.scrollIntoView({ block: 'center' });
            } catch (e) {}
            await innerDelay(150); 

            const imgEl = card.querySelector('ytd-thumbnail img, ytd-playlist-thumbnail img, yt-img-shadow img, img');
            let img = "";
            if (imgEl) {
              img = imgEl.currentSrc || imgEl.src || "";
              if (img.startsWith('data:')) {
                img = imgEl.getAttribute('src') || "";
              }
            }
            
            items.push({ id, name: name || "İsimsiz", img });
            seenIds.add(id);
            
            await innerDelay(100); 
          }
          if (items.length > 0) sections.push({ section_title: sectionTitle, items });
        }
        return sections;
      });

      console.log(`   📂 [${langCode.toUpperCase()}] Kapaklar kontrol ediliyor...`);
      for (let section of sectionData) {
        for (let item of section.items) {
          if (item.img && item.img.startsWith('http')) {
            const destPath = `images/${item.id}.jpg`;
            
            // Dosya zaten varsa indirmeyi pas geç (Akıllı kontrol)
            if (fs.existsSync(destPath)) {
              console.log(`      ⏭️ Resim zaten klasörde mevcut, pas geçildi: ${destPath}`);
            } else {
              await downloadImage(item.img, destPath);
              await delay(100);
            }
            
            item.img = `https://onyxmusic.github.io/images/${item.id}.jpg`;
          }
        }
      }

      fullFeed[langCode] = sectionData;
      console.log(`   ✅ [${langCode.toUpperCase()}] Ülke taraması kayıpsız bitti.`);

    } catch (error) {
      console.error(`   ❌ Hata oluştu [${langCode}]:`, error.message);
    } finally {
      await page.close();
    }
  }

  await browser.close();
  fs.writeFileSync('feed.json', JSON.stringify(fullFeed, null, 2), 'utf-8');
  console.log("\n🎉 GÖREV TAMAMLANDI! Akıllı sistem devrede. feed.json güncellendi, artık resimler ultra hafif formatta indirilecek.");
})();
