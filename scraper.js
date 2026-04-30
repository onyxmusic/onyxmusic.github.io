const puppeteer = require('puppeteer');
const fs = require('fs');

// KRAL İŞTE 12 DİLİN URL'LERİ (Ülke ve Dil kodları ayarlandı)
const TARGET_URLS = {
  "tr": "https://www.youtube.com/feed/music?gl=TR&hl=tr",
  "en": "https://www.youtube.com/feed/music?gl=US&hl=en",
  "fr": "https://www.youtube.com/feed/music?gl=FR&hl=fr",
  "de": "https://www.youtube.com/feed/music?gl=DE&hl=de",
  "es": "https://www.youtube.com/feed/music?gl=ES&hl=es",
  "it": "https://www.youtube.com/feed/music?gl=IT&hl=it",
  "pt": "https://www.youtube.com/feed/music?gl=BR&hl=pt",
  "ru": "https://www.youtube.com/feed/music?gl=RU&hl=ru",
  "ar": "https://www.youtube.com/feed/music?gl=AE&hl=ar",
  "ja": "https://www.youtube.com/feed/music?gl=JP&hl=ja",
  "hi": "https://www.youtube.com/feed/music?gl=IN&hl=hi",
  "zh": "https://www.youtube.com/feed/music?gl=TW&hl=zh-TW"
};

(async () => {
  console.log("🚀 OnyxMusic Otomatik Scraper Başlıyor...");
  
  const browser = await puppeteer.launch({ 
    headless: "new",
    args:['--no-sandbox', '--disable-setuid-sandbox'] 
  });

  // Senin feed.json'ın ana iskeleti
  const fullFeed = {};

  for (const [langCode, url] of Object.entries(TARGET_URLS)) {
    console.log(`\n⏳ İşleniyor:[${langCode.toUpperCase()}] -> ${url}`);
    const page = await browser.newPage();
    
    // YouTube'un bot olduğumuzu anlamaması için
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/114.0.0.0 Safari/537.36');

    try {
      await page.goto(url, { waitUntil: 'networkidle2', timeout: 60000 });
      await page.waitForTimeout(2000); // Sayfanın oturmasını bekle
      
      console.log(`   Sayfa aşağı kaydırılıyor...`);
      // Sayfayı aşağı kaydırma motoru
      await page.evaluate(async () => {
        await new Promise((resolve) => {
          let totalHeight = 0;
          let distance = 300;
          let timer = setInterval(() => {
            let scrollHeight = document.body.scrollHeight;
            window.scrollBy(0, distance);
            totalHeight += distance;
            if (totalHeight >= scrollHeight || totalHeight > 6000) { 
              clearInterval(timer); resolve(); 
            }
          }, 400);
        });
      });

      // SENİN KENDİ YAZDIĞIN KODUN SİSTEME GÖMÜLMÜŞ HALİ
      const sectionData = await page.evaluate(async () => {
        const delay = ms => new Promise(res => setTimeout(res, ms));
        
        async function getFirstVideoId(playlistId) {
          try {
            const res = await fetch(`https://www.youtube.com/playlist?list=${playlistId}`);
            const text = await res.text();
            const match = text.match(/"videoId":"([a-zA-Z0-9_-]{11})"/);
            return match ? match[1] : null;
          } catch (e) { return null; }
        }

        const sections =[];
        const elements = document.querySelectorAll('ytd-rich-section-renderer, ytd-shelf-renderer');
        
        for (let section of elements) {
          const sectionTitle = section.querySelector('#title, #title-text, yt-formatted-string')?.textContent?.trim();
          if (!sectionTitle) continue;

          const items =[];
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

            // Kapak Resmi Çekici
            const videoId = await getFirstVideoId(id);
            const img = videoId ? `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg` : "";
            
            items.push({ id, name: name || "İsimsiz", img });
            seenIds.add(id);
            
            await delay(200); // Ban yememek için 0.2 saniye bekle
          }
          if (items.length > 0) sections.push({ section_title: sectionTitle, items });
        }
        return sections;
      });

      // Tam olarak senin JSON formatın: "tr": [ { section_title: "...", items: [...] } ]
      fullFeed[langCode] = sectionData;
      console.log(`   ✅ ${sectionData.length} kategori başarıyla çekildi!`);

    } catch (error) {
      console.error(`   ❌ Hata oluştu[${langCode}]:`, error.message);
    } finally {
      await page.close();
    }
  }

  await browser.close();

  // Sonuçları feed.json dosyasına yaz
  fs.writeFileSync('feed.json', JSON.stringify(fullFeed, null, 2), 'utf-8');
  console.log("\n🎉 İşlem Tamamlandı! Tüm diller feed.json dosyasına kaydedildi.");
})();
