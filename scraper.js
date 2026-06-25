const puppeteer = require('puppeteer');
const fs = require('fs');

// ADIM 1: Sadece Türkiye kalacak şekilde bölgeleri sınırlandırdık
const REGIONS = {
  "tr": { gl: "TR", hl: "tr" }
};

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

// ADIM 3: Resmi internetten bilgisayara (GitHub sunucusuna) indiren fonksiyon
async function downloadImage(url, destPath) {
  try {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`HTTP hatası! Durum: ${response.status}`);
    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    fs.writeFileSync(destPath, buffer);
    console.log(`      📸 Yeni orijinal kapak indirildi: ${destPath}`);
    return true;
  } catch (error) {
    console.error(`      ❌ Resim indirilemedi: ${url}`, error.message);
    return false;
  }
}

(async () => {
  console.log("🚀 OnyxMusic Otomatik Scraper Başlıyor (Sadece TR & Orijinal Kapak Modu)...");

  // İndirilen resimlerin toplanacağı klasörü kontrol et, yoksa otomatik oluştur
  if (!fs.existsSync('images')) {
    fs.mkdirSync('images');
    console.log("📁 'images' klasörü oluşturuldu.");
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

      // "Daha fazla göster" butonlarına tıkla (Sadece Türkçe ve İngilizce butonlar kaldı)
      let expandRound = 0;
      while (expandRound < 10) {
        const clicked = await page.evaluate(() => {
          const buttons = Array.from(document.querySelectorAll('button, tp-yt-paper-button, yt-button-shape button')).filter(btn => {
            const text = (btn.textContent || '').trim().toLowerCase();
            return (
              text.includes('daha fazla göster') ||
              text.includes('show more')
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

      console.log("   Orijinal kapak linkleri sayfadan toplanıyor...");
      const sectionData = await page.evaluate(() => {
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

            // ADIM 2: F12 testindeki orijinal kapak yakalama mantığı buraya eklendi
            const imgEl = card.querySelector('img');
            const rawImg = imgEl?.src || imgEl?.getAttribute('src') || '';

            if (rawImg && !rawImg.startsWith('data:')) {
              // Resimleri hemen indirmek yerine linki Node.js tarafına paslıyoruz
              items.push({ id, name: name || "İsimsiz", rawImg });
              seenIds.add(id);
            }
          }
          if (items.length > 0) sections.push({ section_title: sectionTitle, items });
        }
        return sections;
      });

      // --- Node.js Tarafında Resimleri Kontrol Edip İndirme ve Link Değiştirme Alanı ---
      console.log("   📥 Resim indirme ve optimizasyon süreci başladı...");
      for (let section of sectionData) {
        for (let item of section.items) {
          const destPath = `images/${item.id}.jpg`;
          
          // Akıllı Kontrol: Eğer bu kapak zaten indirilmişse pas geç, indirilmemişse indir
          if (!fs.existsSync(destPath)) {
            await downloadImage(item.rawImg, destPath);
            await delay(1000); // YouTube'u çok sıkıştırmamak için milisaniyelik es
          }

          // feed.json içindeki resmi senin kalıcı GitHub Pages linkine çeviriyoruz
          // NOT: GitHub Pages domain yapına göre burayı güncelleyebilirsin (Örn: onyxmusic.github.io/images/...)
          item.img = `https://onyxmusic.github.io/images/${item.id}.jpg`;
          
          // Geçici olarak kullandığımız ham YouTube linkini feed.json'da kirlilik yapmasın diye siliyoruz
          delete item.rawImg;
        }
      }

      fullFeed[langCode] = sectionData;
      console.log(`   ✅ Türkiye kategorileri orijinal kapaklarla başarıyla işlendi!`);

    } catch (error) {
      console.error(`   ❌ Hata oluştu [${langCode}]:`, error.message);
    } finally {
      await page.close();
    }
  }

  await browser.close();
  fs.writeFileSync('feed.json', JSON.stringify(fullFeed, null, 2), 'utf-8');
  console.log("\n🎉 İşlem Tamamlandı! Türkiye feed.json dosyasına kaydedildi.");
})();
