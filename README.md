# 🐉 Dragon Service — Render.com 7/24 Bulut Kurulum Rehberi

## Ne Yaptık?
Bu güncellemeyle Dragon Service artık **tamamen headless (ekrансız) sunucu modunda** çalışabiliyor.  
Render.com'a yükleyince hesaplar **kalıcı olarak seste kalır**, sen çıksan bile.

---

## 📁 Adım 1: Projeyi GitHub'a Yükle

Render.com, GitHub reposundan okur. Önce projeyi GitHub'a at:

```bash
# Masaüstünde Git Bash veya CMD aç:
cd C:\Users\ghosT\Desktop\electron-app
git init
git add .
git commit -m "Dragon Service Cloud 24/7"
git remote add origin https://github.com/SENIN_KULLANICI_ADIN/dragon-service.git
git push -u origin main
```

> GitHub hesabın yoksa https://github.com adresinde ücretsiz aç.  
> Repo oluşturmak için: GitHub > New Repository > "dragon-service" > Create > komutları çalıştır.

---

## ☁️ Adım 2: Render.com'a Deploy Et

1. **https://render.com** adresine git → ücretsiz hesap aç
2. **"New +"** → **"Web Service"** seç
3. GitHub hesabını bağla → `dragon-service` reposunu seç
4. Ayarlar:

| Alan | Değer |
|------|-------|
| Name | `dragon-service` |
| Region | Frankfurt (EU) |
| Branch | `main` |
| Build Command | `cd frontend && npm install && npm run build && cd .. && npm install` |
| Start Command | `node backend/server.js` |
| Plan | Free (veya Starter \$7/ay — Free uyuyabilir!) |

5. **"Create Web Service"** tıkla → deploy başlar (~3-5 dakika)

---

## 🔗 Adım 3: Uygulamayı Tarayıcıdan Kullan

Deploy tamamlandığında Render sana şöyle bir URL verir:
```
https://dragon-service-xxxx.onrender.com
```

Bu URL'yi **tarayıcında** aç → Dragon Service arayüzü açılır.  
Buradan:
- Token ekle
- Kanal ID gir → "Tümünü Sese Sok" bas
- Hesaplar sese girer ve **sen kapatsan bile orada kalır**

---

## ⚡ Adım 4: 7/24 Uyanık Tutma (Free Tier için)

Render Free tier 15 dakika işlem olmasa uyutur. Bunu engellemek için:

### Yöntem A — UptimeRobot (Ücretsiz)
1. https://uptimerobot.com adresine git → ücretsiz hesap aç
2. **"Add New Monitor"** → HTTP(S) seç
3. URL: `https://dragon-service-xxxx.onrender.com/ping`
4. Interval: **5 minutes**
5. Kaydet → artık 7/24 ping atar, uykuya daldırmaz

### Yöntem B — Render Paid Plan (\$7/ay)
Starter planı alırsan uykuya dalmaz, kesinlikle önerilir.

---

## 💾 Kalıcı Ses Kanalı Özelliği

Hesapları sese soktuğunda sistem `voice_config.json` dosyasına kanal ID'yi kaydeder.  
Sunucu yeniden başlasa bile **otomatik olarak aynı kanala geri döner** (15 saniye içinde).

---

## 🔧 Sorun Giderme

| Sorun | Çözüm |
|-------|-------|
| "Module not found: electron" hatası | Normal — Cloud'da Electron çalışmaz, sadece `node backend/server.js` çalışır |
| Hesaplar sesi bırakıyor | UptimeRobot kur, 7/24 ping at |
| "Cannot find frontend" | Build komutunu tam yaz: `cd frontend && npm install && npm run build && cd .. && npm install` |
| Kanal ID nereden bulunur? | Discord'da kanala sağ tıkla → "Kanal ID'sini Kopyala" (Geliştirici Modu açık olmalı) |
